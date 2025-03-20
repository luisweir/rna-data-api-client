import fs from 'fs';
import path from 'path';
import { log } from '../logger';

let fileCounter = 1;

const processChunk = (chunk: any, config: any) => {
    try {
        if (!fs.existsSync(config.outDir)) {
            fs.mkdirSync(config.outDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${config.fileName}.${String(fileCounter).padStart(2, '0')}.${timestamp}.json`;
        const filePath = path.join(config.outDir, fileName);
        
        fs.writeFileSync(filePath, JSON.stringify(chunk, null, 2), 'utf8');
        log.debug(`Saved: ${filePath}`);
        
        fileCounter++;
    } catch (error) {
        log.error('Error writing JSON file:', error);
    }
};

export default processChunk;
