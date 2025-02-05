import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { log } from './logger';
import { DataClient, Environment } from './DataClient';
import { gql } from '@apollo/client/core';

dotenv.config({ path: process.env.ENVPATH || './.env' });

const env: Environment = {
    APIGW_URL: process.env.APIGW_URL || '',
    OAUTH_ENDPOINT: process.env.OAUTH_ENDPOINT || '/oauth/v1/tokens',
    DATA_ENDPOINT: process.env.DATA_ENDPOINT || '/rna/v1/graphql',
    OAUTH_SCOPE: process.env.OAUTH_SCOPE || 'urn:opc:hgbu:ws:__myscopes__',
    APP_KEY: process.env.APP_KEY || '',
    CLIENT_ID: process.env.CLIENT_ID || '',
    CLIENT_SECRET: process.env.CLIENT_SECRET || '',
    ENTERPRISE_ID: process.env.ENTERPRISE_ID || '',
    EXCLUDE_NULL: process.env.EXCLUDE_NULL === 'true',
    TOKEN_EXPIRY: Number(process.env.TOKEN_EXPIRY) || 3540000,
    QUERY_NAME: process.env.QUERY_NAME,
    FILTER_NAME: process.env.FILTER_NAME,
    FILTER_VARS: process.env.FILTER_VARS || '',
    QUERY_FOLDER: process.env.QUERY_FOLDER || './queries',
    FILTER_FOLDER: process.env.FILTER_FOLDER || './filters',
    PLUGIN_NAME: process.env.PLUGIN_NAME,
    PLUGIN_FOLDER: process.env.PLUGIN_FOLDER || 'plugins'
};

log.debug('Loaded environment variables:', env);

const parseFilterVars = (filterVars: string | undefined): { [key: string]: string | number } => {
    if (!filterVars) return {};
    log.debug('Parsing filter variables:', filterVars);
    return filterVars.split(',').reduce<{ [key: string]: string | number }>((acc, pair) => {
        const [key, value] = pair.split(':');
        if (key && value) {
            acc[key.trim()] = isNaN(Number(value.trim())) ? value.trim() : Number(value.trim());
        }
        return acc;
    }, {});
};

const replaceVariables = (rawData: string, variables: { [key: string]: any }): any => {
    log.silly('Replacing variables in data:', rawData, `\nwith:`, variables);
    
    let hasUnreplacedVars = false;

    const replaced = rawData.replace(/"{{([^{}]+)}}"|{{([^{}]+)}}/g, (match: any, quotedKey, unquotedKey) => {
        const key = quotedKey || unquotedKey;
        if (variables.hasOwnProperty(key)) {
            const value = variables[key];

            // If it's a quoted placeholder ("{{key}}"), always stringify the value
            if (quotedKey) {
                return JSON.stringify(value);
            }

            // If it's an unquoted placeholder ({{key}}), ensure correct formatting:
            // - Strings should be quoted
            // - Numbers should remain numbers
            return typeof value === "string" ? JSON.stringify(value) : value;
        }

        // If the variable is not found, mark it as an error
        hasUnreplacedVars = true;
        return match; // Keep the placeholder unchanged
    });

    if (hasUnreplacedVars) {
        log.error("Error: Some variables could not be replaced. Ensure they are set in the environment variable FILTER_VARS.");
        throw new Error("Some variables could not be replaced. Ensure they are set in the environment variable FILTER_VARS.");
    }

    log.silly(`Final replaced data:`, replaced);

    try {
        return JSON.parse(replaced);
    } catch (error) {
        log.error("Error parsing JSON after variable replacement:", error);
        return null;
    }
};

const loadQuery = (queryName: string, folderPath: string): string => {
    const filePath = path.join(folderPath, `${queryName}.gql`);
    log.debug(`Loading query from file: ${filePath}`);
    return fs.readFileSync(filePath, 'utf8');
};

const loadFilters = (filterName: string, folderPath: string, filterVars: string | undefined): any => {
    const filePath = path.join(folderPath, `${filterName}.json`);
    log.debug(`Loading filters from file: ${filePath}`);
    const rawData = fs.readFileSync(filePath, 'utf8');
    let parsedVars = parseFilterVars(filterVars);
    log.debug(`Parsed Variables: `, parsedVars);
    return replaceVariables(rawData, parsedVars);
};

const loadPlugins = async (pluginFolder: string): Promise<{ [key: string]: any }> => {
    const isTsNode = process.argv[0].includes('ts-node');
    const pluginsDir = isTsNode
        ? path.join('./src/', pluginFolder)
        : path.join('./dist/', pluginFolder);
    
    log.debug(`Looking for plugins in: ${pluginsDir}`);
    
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
        throw new Error(`Plugin directory not found: ${pluginsDir}`);
    }
    
    const extension = isTsNode ? '.ts' : '.js';
    const pluginFiles = fs.readdirSync(pluginsDir).filter(file => file.endsWith(extension));
    
    const plugins: { [key: string]: any } = {};
    for (const file of pluginFiles) {
        const pluginName = path.basename(file, path.extname(file));
        const pluginPath = path.resolve(pluginsDir, file);
        log.debug(`Loading plugin: ${pluginPath}`);
        plugins[pluginName] = (await import(pluginPath)).default;
    }
    return plugins;
};

const run = async () => {
    log.info('Starting execution...');
    const client = new DataClient(env);

    if (!env.QUERY_NAME) {
        throw new Error(`Please set environment variable QUERY_NAME with the name of your query file in ${env.QUERY_FOLDER}`);
    }

    if (!env.FILTER_NAME) {
        throw new Error(`Please set environment variable FILTER_NAME with the name of your filter file in ${env.FILTER_FOLDER}`);
    }

    log.info(`Loading query: ${env.QUERY_NAME}`);
    const query = gql`${loadQuery(env.QUERY_NAME, env.QUERY_FOLDER)}`;
    log.info(`Loading filters: ${env.FILTER_NAME}`);
    const filters = loadFilters(env.FILTER_NAME, env.FILTER_FOLDER, env.FILTER_VARS);

    log.info('Executing GraphQL query...');
    log.debug(`final filters`, filters);

    // check if plugin was set only if directive stream being used
    if (query.loc?.source.body.toString().includes("@stream")){
        log.info(`Query using @stream directive`);
        if (!env.PLUGIN_NAME) {
            throw new Error(`Please set environment variable PLUGIN_NAME with the name of the plugin to use to handle chunks`);
        }
        const plugins = await loadPlugins(env.PLUGIN_FOLDER);
        if (!plugins[env.PLUGIN_NAME]) {
            throw new Error(`Plugin "${env.PLUGIN_NAME}" not found in ./plugins`);
        }
        log.info(`Using plugin: ${env.PLUGIN_NAME}`);
        // Run the data fetch with the selected plugin for processing chunks
        const outcome = await client.fetchData(query, filters, plugins[env.PLUGIN_NAME]);
        console.table(outcome);
    } else {
        // Run the data fetch as normal http call
        const result = await client.fetchData(query, filters);
        console.log(result);
    };
};

run().catch(error => {
    log.error('Execution failed:', error);
    process.exit(1);
});
