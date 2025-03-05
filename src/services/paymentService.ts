import { Connection, PublicKey,Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PaymentsStorage } from "../storage";
import { IAgentRuntime } from "@elizaos/core";
import { Result } from "@aithranetwork/sdk-aithra-toolkit";
import bs58 from "bs58";

class TransactionNotFoundError extends Error {
    constructor() {
        super("Transaction not found");
    }
}

class TransferInstructionNotFoundError extends Error {
    constructor() {
        super("Transfer instruction not found in transaction");
    }
}

type TransferDetails = {
    receiver: string;
    sender: string;
    amount: string;
};

export class PaymentsService {
    private readonly rpcUrl: string;
    private readonly paymentsStorage:PaymentsStorage;
    private readonly AITHRA_MINT = new PublicKey(
        'iTHSaXjdqFtcnLK4EFEs7mqYQbJb6B7GostqWbBQwaV'
    );
    private readonly walletPublicKey:string = '';

    constructor(rpcUrl: string,runtime:IAgentRuntime) {
        this.rpcUrl = rpcUrl;
        this.paymentsStorage = new PaymentsStorage(runtime);

        const privateKey = runtime.getSetting("AITHRA_PRIVATE_KEY");
        const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));

        this.walletPublicKey = keypair.publicKey.toBase58();


    }


    private async getSolTransferDetails(tx: string): Promise<Result<TransferDetails, Error>> {
        try {
            const connection = new Connection(this.rpcUrl, "confirmed");
    
            const transaction = await connection.getParsedTransaction(tx, {
                maxSupportedTransactionVersion: 0,
            });
    
            if (!transaction || transaction.meta?.err) {
                return Result.err(new TransactionNotFoundError());
            }
    
            const instructions = transaction.transaction.message.instructions;
    
            const transferInstruction = instructions.find((instruction) => {
                if ("parsed" in instruction) {
                    return instruction.program === "system" && instruction.parsed.type === "transfer";
                }
                return false;
            });
    
            if (transferInstruction && "parsed" in transferInstruction) {
                const { info } = transferInstruction.parsed;
                if ("destination" in info && "source" in info) {
                    return Result.ok({
                        receiver: info.destination,
                        sender: info.source,
                        amount: (Number(info.lamports) / 1e9).toString(), // Convert lamports to SOL
                    });
                }
            }
    
            return Result.err(new TransferInstructionNotFoundError());
        } catch (error) {
            return Result.err(error instanceof Error ? error : new Error(String(error)));
        }
    }


    private async getSplTransferDetails(tx: string): Promise<Result<TransferDetails, Error>> {
        try {
            const connection = new Connection(this.rpcUrl, "confirmed");

            const transaction = await connection.getParsedTransaction(tx, {
                maxSupportedTransactionVersion: 0,
            });

            if (!transaction || transaction.meta?.err) {
                return Result.err(new TransactionNotFoundError());
            }

            const instructions = transaction.transaction.message.instructions;

            const transferInstruction = instructions.find((instruction) => {
                if ("parsed" in instruction) {
                    return instruction.parsed.type === "transfer" || instruction.parsed.type === "transferChecked";
                }
                return false;
            });

            if (transferInstruction && "parsed" in transferInstruction) {
                const { info, type } = transferInstruction.parsed;
                if ("destination" in info && "source" in info) {
                    if (type === "transferChecked" && "tokenAmount" in info) {
                        return Result.ok({
                            receiver: info.destination,
                            sender: info.source,
                            amount: info.tokenAmount.uiAmount,
                        });
                    } else if (type === "transfer" && "amount" in info) {
                        return Result.ok({
                            receiver: info.destination,
                            sender: info.source,
                            amount: info.amount,
                        });
                    }
                }
            }

            return Result.err(new TransferInstructionNotFoundError());
        } catch (error) {
            return Result.err(error instanceof Error ? error : new Error(String(error)));
        }
    }

    async verifyEligiblePayment(params: {
        paymentHash: string;
        totalCost: number;
        walletAddress: string;
    }): Promise<Result<void, Error>> {
        const { paymentHash, totalCost, walletAddress } = params;

        const slippage = 0.005;
        const totalCostWithSlippage = totalCost * (1 + slippage);
    
        const isInUse = await this.paymentsStorage.getPayment(paymentHash);
    
        if (isInUse) {
            return Result.err(new Error("Payment already in use"));
        }
    
        // First try SOL transfer
        const solResult = await this.getSolTransferDetails(paymentHash);
    
        if (solResult.isOk) {
            const { receiver, sender, amount } = solResult.unwrap();
    
            if (sender !== walletAddress || receiver !== this.walletPublicKey) {
                return Result.err(new Error("Invalid sender or receiver addresses for SOL transfer"));
            }

            // get AITHRA price in SOL
            const priceResult = await this.getAithraPriceInSol();
            
            if (priceResult.isErr()) {
                return Result.err(priceResult.getErr());
            }

            const aithraPriceInSol = priceResult.unwrap();

            const totalCostInSol = Number(totalCostWithSlippage) * Number(aithraPriceInSol);

    
            if (Number(amount) <= Number(totalCostInSol)) {
                return Result.err(new Error("Insufficient SOL funds"));
            }
    
            await this.paymentsStorage.setPayment({
                hash: paymentHash,
                amount: Number(amount),
                date: new Date().toISOString(),
                from: sender,
                to: receiver
            });
    
            return Result.ok();
        }
    
        // If not SOL transfer, try SPL token transfer
        const splResult = await this.getSplTransferDetails(paymentHash);
    
        if (splResult.isOk) {
            const { receiver, sender, amount } = splResult.unwrap();
    
            const sourceAta = getAssociatedTokenAddressSync(this.AITHRA_MINT, new PublicKey(walletAddress), true);
            const receiverAta = getAssociatedTokenAddressSync(this.AITHRA_MINT, new PublicKey(this.walletPublicKey), true);
    
            if (sender !== sourceAta.toBase58() || receiver !== receiverAta.toBase58()) {
                return Result.err(new Error("Invalid sender or receiver addresses for SPL transfer"));
            }
    
            if (Number(amount) <= Number(totalCostWithSlippage)) {
                return Result.err(new Error("Insufficient token funds"));
            }
    
            await this.paymentsStorage.setPayment({
                hash: paymentHash,
                amount: Number(amount),
                date: new Date().toISOString(),
                from: sender,
                to: receiver
            });
    
            return Result.ok();
        }
    
        return Result.err(new Error("No valid transfer found in transaction"));
    }

    public async deletePayment(paymentHash: string): Promise<Result<void,Error>> {
        try {
            await this.paymentsStorage.deletePayment(paymentHash);
            return Result.ok();
        } catch (error) {
            return Result.err(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private async getAithraPriceInSol(): Promise<Result<number, Error>> {
        try {
          const tokenData = await (
            await fetch(
              `https://api.jup.ag/price/v2?ids=${this.AITHRA_MINT.toString()}&vsToken=So11111111111111111111111111111111111111112`
            )
          ).json();
          return Result.ok(tokenData.data[this.AITHRA_MINT.toString()].price);
        } catch (err) {
          return Result.err(new Error(`Failed to get SOL price: ${err.message}`));
        }
      }
}