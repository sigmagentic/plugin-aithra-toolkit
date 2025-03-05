import { IAgentRuntime } from "@elizaos/core";
import { z } from "zod";

export const aithraEnvSchema = z.object({
    SOLANA_RPC_URL: z.string().min(1, "Solana RPC URL is required"),
    AITHRA_PRIVATE_KEY: z.string().min(1, "Aithra private key is required"),
    AITHRA_PRIORITY_FEE: z
        .number()
        .min(0, "Priority fee must be a non-negative number"),
});

export type AithraConfig = z.infer<typeof aithraEnvSchema>;

export async function validateAithraConfig(
    runtime: IAgentRuntime
): Promise<AithraConfig> {
    try {
        const config = {
            SOLANA_RPC_URL:
                runtime.getSetting("SOLANA_RPC_URL") ||
                process.env.SOLANA_RPC_URL,
            AITHRA_PRIVATE_KEY:
                runtime.getSetting("AITHRA_PRIVATE_KEY") ||
                process.env.AITHRA_PRIVATE_KEY,
            AITHRA_PRIORITY_FEE:
                Number(runtime.getSetting("AITHRA_PRIORITY_FEE")) ||
                Number(process.env.AITHRA_PRIORITY_FEE),
        };

        return aithraEnvSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join(".")}: ${err.message}`)
                .join("\n");
            throw new Error(
                `Aithra configuration validation failed:\n${errorMessages}`
            );
        }
        throw error;
    }
}
