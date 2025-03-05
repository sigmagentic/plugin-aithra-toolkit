import 'reflect-metadata';
import Replicate from "replicate";
import {Result} from "@aithranetwork/sdk-aithra-toolkit";
import { IAgentRuntime } from '@elizaos/core';

export class SchemaField {
    constructor(
        public type: string,
        public description?: string
    ) {}
}

export function Description(description: string) {
    return function(target: any, propertyKey: string) {
        Reflect.defineMetadata('description', description, target, propertyKey);
    };
}

export class SchemaGenerator {
    static generateJSONSchema(classType: any): string {
        const schema = this.parseClass(classType);
        return this.convertToPrompt(schema);
    }

    private static parseClass(classType: any): Record<string, SchemaField> {
        const schema: Record<string, SchemaField> = {};
        const instance = new classType();
        const prototype = Object.getPrototypeOf(instance);

        for (const key of Object.keys(instance)) {
            const type = Reflect.getMetadata('design:type', prototype, key);
            const description = Reflect.getMetadata('description', instance, key);
            const actualValue = instance[key];
            
            let typeString: string;
            if (type === Array || Array.isArray(actualValue)) {
                typeString = 'string[]'; // For this use case, we know we want string arrays
            } else if (this.isNestedObject(actualValue)) {
                typeString = this.parseNestedObject(actualValue);
            } else {
                typeString = this.getTypeString(type || actualValue?.constructor, actualValue);
            }

            schema[key] = new SchemaField(typeString, description);
        }

        return schema;
    }

    private static isNestedObject(value: any): boolean {
        return value !== null && 
               typeof value === 'object' && 
               !Array.isArray(value) &&
               Object.keys(value).length > 0;
    }

    private static parseNestedObject(obj: any): string {
        let result = '{\n';
        for (const [key, value] of Object.entries(obj)) {
            const type = typeof value;
            result += `        ${key}: ${type},\n`;
        }
        result += '    }';
        return result;
    }

    private static getTypeString(type: any, value: any): string {
        if (!type) return typeof value;

        const typeName = type.name.toLowerCase();
        switch (typeName) {
            case 'string': return 'string';
            case 'number': return 'number';
            case 'boolean': return 'boolean';
            case 'array': return 'string[]';
            case 'object': return typeof value;
            default: return type.name;
        }
    }

    private static convertToPrompt(schema: Record<string, SchemaField>): string {
        let prompt = 'Answer ONLY with JSON using this schema:\n{\n';

        Object.entries(schema).forEach(([key, field]) => {
            if (field.description) {
                prompt += `  // ${field.description}\n`;
            }
            const indent = field.type.includes('{\n') ? '' : '  ';
            prompt += `  ${key}: ${field.type},\n`;
        });

        prompt += '}';
        return prompt;
    }
}


// const prompt = SchemaGenerator.generatePrompt(Receipt);
// console.log(prompt);









export function convertBase64ToBuffer(base64String: string): { buffer: Buffer; extension: string } {
    // Remove data URL prefix if present
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');

    // Get extension from data URL
    const extension = base64String.split(';')[0]?.split('/')[1] || 'unknown';

    // Convert to buffer
    const buffer = Buffer.from(base64Data, 'base64');

    return {
      buffer,
      extension
    };
  }

export async function generateAudio({
    prompt,
    lyrics,
    referenceAudioUrl
}: {
    prompt?: string;
    lyrics?: string;
    referenceAudioUrl?: string;
}, runtime: IAgentRuntime): Promise<Result<Buffer, Error>> {
    try {
        const replicate = new Replicate({
            auth: runtime.getSetting("REPLICATE_API_TOKEN"),
        });

        const input = {
            lyrics: lyrics ?? "[intro]\n\nUpload my heart to the digital sky\nAlgorithm love, you make me feel so high\nBinary kisses, ones and zeros fly (fly)\nOoooh ooooh\n\n[chorus]\nYour neural network's got me feeling so alive",
            bitrate: 256000,
            song_file: referenceAudioUrl ?? "https://raw.githubusercontent.com/Itheum/data-assets/main/Misc/1-dnandb-seimicpulse-a.mp3",
            sample_rate: 44100
        };
          
        const response = await replicate.run("minimax/music-01", { input });
        
     
        if (response instanceof ReadableStream) {
            const reader = response.getReader();
            const chunks: Uint8Array[] = [];
        
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
        
            const audioBuffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
            return Result.ok(audioBuffer);
        }
    

        return Result.err(new Error('Invalid response format from Replicate API'));
    } catch (error) {
        return Result.err(error instanceof Error ? error : new Error('Unknown error occurred while generating audio'));
    }
}
