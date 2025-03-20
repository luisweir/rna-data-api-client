import { log } from './logger';
import axios, { AxiosError } from 'axios';

export class Call {
    // HTTP invoker
    public async call(url: string, options: any): Promise<any> {
        try {
            const response = await axios({
                url,
                ...options
            });
            return response.data;
        } catch (err) {
            const error = {
                'httpStatusCode': (err as AxiosError).response?.status,
                'msg': (err as AxiosError).response?.statusText,
                'reason': (err as AxiosError).response?.data
            };
            log.error(`throwing error`);
            throw error;
        }
    }

    public async fetchToken(url: string, options: any) {
        try {
            log.debug(`Obtaining access token from ${url}`);
            const token = await this.call(url, options);
            log.debug('Successfully fetched access token');
            return token;
        } catch (error) {
            log.error(error);
        }
    }

    private static removeNulls(obj: any): any {
        if (Array.isArray(obj)) {
            return obj.map(Call.removeNulls).filter(item => item !== null);
        } else if (obj !== null && typeof obj === 'object') {
            return Object.fromEntries(
                Object.entries(obj)
                    .map(([key, value]) => [key, Call.removeNulls(value)])
                    .filter(([, value]) => value !== null)
            );
        }
        return obj;
    }

    public async fetchStreamingData(url: string, options: any, excludeNull?: boolean, processChunk?: (chunk: any, config: any) => void, processConfig?: any): Promise<any[][]> {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}`);
            }
            if (!response.body) {
                throw new Error("ReadableStream not supported in response");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let chunkCount = 0;
            let totalSize = 0;
            let totalRecords = 0;
            const startTime = Date.now();
            let totalChunkProcessingTime = 0;

            while (true) {
                const chunkStartTime = Date.now();
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                totalSize += value.byteLength;
                chunkCount++;
                totalChunkProcessingTime += Date.now() - chunkStartTime;
                log.silly(`Received chunk: ${chunk}`);
                
                let parts = buffer.split(/---\s*\n/);
                buffer = parts.pop() || "";
                
                for (let part of parts) {
                    part = part.trim();
                    if (!part) continue;
                    
                    // Remove headers from chunk and extract JSON
                    const jsonStart = part.indexOf('{');
                    const jsonEnd = part.lastIndexOf('}');
                    if (jsonStart === -1 || jsonEnd === -1) {
                        log.silly(`Skipping non-JSON chunk: ${part}`);
                        continue;
                    }
                    part = part.substring(jsonStart, jsonEnd + 1);

                    try {
                        log.silly(`Processing JSON chunk`);
                        let json = JSON.parse(part);
                        totalRecords ++;

                        // Recursively remove all null values from JSON
                        if(excludeNull) {
                            json = Call.removeNulls(json);
                        };

                        log.silly(json);

                        if (processChunk) {
                            processChunk(json, processConfig);
                        }
                    } catch (err) {
                        log.error("Error parsing JSON chunk:", err);
                        log.error(`Raw chunk causing error: ${part}`);
                    }
                }
            }
            
            const totalTime = Date.now() - startTime;
            const avgChunkTime = chunkCount > 0 ? (totalChunkProcessingTime / chunkCount).toFixed(2) + " ms" : "0 ms";
            return [
                ["Total Chunks Processed", chunkCount],
                ["Total Records Received", totalRecords - 2],
                ["Total Data Received (KB)", (totalSize / 1024).toFixed(2) + " KB"],
                ["Total Processing Time (ms)", totalTime + " ms"],
                ["Average Chunk Processing Time (ms)", avgChunkTime]
            ];
        } catch (error) {
            log.error('Streamed GraphQL request failed:', error);
            throw error;
        }    
    }
}