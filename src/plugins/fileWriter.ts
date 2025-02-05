import fs from 'fs';
import path from 'path';
import { log } from '../logger';

const OUTPUT_DIR = './data';
const FILE_PREFIX = 'profileItem';
let fileCounter = 1;

const processChunk = (chunk: any) => {
    try {
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${FILE_PREFIX}.${String(fileCounter).padStart(2, '0')}.${timestamp}.json`;
        const filePath = path.join(OUTPUT_DIR, fileName);
        
        fs.writeFileSync(filePath, JSON.stringify(chunk, null, 2), 'utf8');
        log.debug(`Saved: ${filePath}`);
        
        fileCounter++;
    } catch (error) {
        log.error('Error writing JSON file:', error);
    }
};

export default processChunk;
