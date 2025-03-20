import { ApolloClient, InMemoryCache, HttpLink, NormalizedCacheObject, gql} from '@apollo/client/core';
import { Call } from './Call';
import { log } from './logger';

export interface Environment {
    APIGW_URL: string;
    OAUTH_ENDPOINT: string;
    DATA_ENDPOINT: string;
    OAUTH_SCOPE: string;
    APP_KEY: string;
    CLIENT_ID: string;
    CLIENT_SECRET: string;
    ENTERPRISE_ID: string;
    EXCLUDE_NULL: boolean;
    TOKEN_EXPIRY: number;
    QUERY_NAME: string | undefined;
    FILTER_NAME: string | undefined;
    FILTER_VARS: string | undefined;
    QUERY_FOLDER: string;
    FILTER_FOLDER: string;
    PLUGIN_NAME: string | undefined;
    PLUGIN_FOLDER: string;
}

export class DataClient {
    private readonly env: Environment;
    private authToken: string | null = null;
    private tokenExpiryTime: number = 0;
    private gqlUrl: string;
    private oauthUrl: string;
    private client: ApolloClient<NormalizedCacheObject> | null = null;
    private callInstance: Call;

    constructor(env: Environment) {
        this.env = env;
        this.gqlUrl = this.env.APIGW_URL + this.env.DATA_ENDPOINT;
        this.oauthUrl = this.env.APIGW_URL + this.env.OAUTH_ENDPOINT;
        this.callInstance = new Call();
    }

    private async fetchAuthToken(): Promise<string> {
        log.debug(`fetching token`);
        const method = 'POST';
        const authZ = Buffer.from(this.env.CLIENT_ID + ':' + this.env.CLIENT_SECRET).toString('base64');

        const oauthOptions = {
            method,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-app-key': this.env.APP_KEY,
                Authorization: 'Basic ' + authZ,
                enterpriseId: this.env.ENTERPRISE_ID
            },
            data: {
                'grant_type': 'client_credentials',
                'scope': this.env.OAUTH_SCOPE
            },
            timeout: 30000,
        };

        const response = await this.callInstance.fetchToken(this.oauthUrl, oauthOptions);
        this.tokenExpiryTime = Date.now() + this.env.TOKEN_EXPIRY;
        return response.access_token;
    }

    public async init(): Promise<void> {
        log.debug(`Initialising client`);
        this.authToken = await this.fetchAuthToken();
        log.silly(this.authToken);

        this.client = new ApolloClient({
            link: new HttpLink({
                uri: this.gqlUrl,
                headers: {
                    'x-app-key': this.env.APP_KEY,
                    'Authorization': `Bearer ${this.authToken}`,
                    'Accept': 'multipart/mixed; deferSpec=20220824, application/json',
                    'Content-Type': 'application/json',
                },
                fetchOptions: { fetch: (uri: string, options: any) => this.callInstance.call(uri, options) },
            }),
            cache: new InMemoryCache(),
        });
    }

    private hasStreamDirective(query: any): boolean {
        return query.loc.source.body.toString().includes("@stream");
    }

    public async fetchData(query: any, vars: any, processChunk?: (chunk: any) => void): Promise<any> {
        if (!this.authToken || Date.now() >= this.tokenExpiryTime) {
            await this.init();
        }

        if (!this.client) {
            throw new Error('DataClient has not been initialised. Call init() before using it.');
        }

        const useStream = this.hasStreamDirective(query);
        
        log.info(`Calling GraphQL URL: ${this.gqlUrl}`);
        log.debug(`Using Streaming? ${useStream}`);

        if (!useStream) {
            log.info('Executing request/response HTTP call');
            try {
                const response = await this.client.query({
                    query,
                    variables: vars,
                    fetchPolicy: 'network-only',
                });
                return response.data;
            } catch (error) {
                console.error('GraphQL request failed:', error);
                throw error;
            }
        }

        const options = {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'multipart/mixed; deferSpec=20220824',
                'x-app-key': this.env.APP_KEY,
                'Authorization': `Bearer ${this.authToken}`,
            },
            body: JSON.stringify({ query: typeof query === 'object' && 'loc' in query ? query.loc.source.body : query, variables: vars || {} })
        };
        log.info('Executing request/stream HTTP call');
        return this.callInstance.fetchStreamingData(this.gqlUrl, options, this.env.EXCLUDE_NULL, processChunk, {fileName: this.env.QUERY_NAME, outDir: './data'});
    }
}
