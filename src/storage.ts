import { IAgentRuntime } from "@elizaos/core";
import { EventEmitter } from "events";


export interface Payment { 
    hash:string,
    amount:number,
    date: string,
    from: string,
    to: string,
}

export class CacheStorage<T> {
    private runtime: IAgentRuntime;
    private cacheKey: string;
    private compareFunction: (a: T, b: T) => boolean;

    constructor(
        runtime: IAgentRuntime,
        cacheKey: string,
        compareFunction: (a: T, b: T) => boolean = (a, b) => a === b
    ) {
        this.runtime = runtime;
        this.cacheKey = cacheKey;
        this.compareFunction = compareFunction;
    }

    async setValue(key: string, value: T): Promise<void> {
        if (!value) {
            console.warn("Value is undefined, skipping set");
            return;
        }
        await this.runtime.cacheManager.set(key, value);
    }

    async getValue<R>(key: string): Promise<R | null> {
        return await this.runtime.cacheManager.get<R>(key);
    }

    async append(value: T | T[]): Promise<void> {
        if (!value) {
            console.warn("Value is undefined, skipping append");
            return;
        }

        const cached = await this.getAll();
        const valuesToAdd = Array.isArray(value) ? value : [value];

        valuesToAdd.forEach((item) => {
            if (
                !cached.some((existingItem) =>
                    this.compareFunction(existingItem, item)
                )
            ) {
                cached.push(item);
            }
        });

        await this.runtime.cacheManager.set(this.cacheKey, cached);
    }

    async remove(value: T): Promise<void> {
        if (!value) {
            console.warn("Value is undefined, skipping removal");
            return;
        } 

        const cached = await this.getAll();
        const filtered = cached.filter(
            (item) => !this.compareFunction(item, value)
        );
        await this.runtime.cacheManager.set(this.cacheKey, filtered);
    }

    async getAll(): Promise<T[]> {
        const cached = await this.runtime.cacheManager.get<T[]>(this.cacheKey);
        return cached || [];
    }

    async clear(): Promise<void> {
        await this.runtime.cacheManager.set(this.cacheKey, []);
    }
}

export class PaymentsStorage {
    runtime: IAgentRuntime;
    private storage: CacheStorage<Payment>;
    private hashesStorage: CacheStorage<string>;
    private readonly PAYMENT_PREFIX = "payments/payment/";

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
        this.storage = new CacheStorage<Payment>(runtime, "payments");
        this.hashesStorage = new CacheStorage<string>(runtime, "paymentHashes");
    }


    async checkPaymentExists(hash: string): Promise<boolean> {
        const key = this.PAYMENT_PREFIX + hash;
        return await this.storage.getValue(key) !== null;
    }

    async setPayment(payment: Payment): Promise<void> {
        const key = this.PAYMENT_PREFIX + payment.hash;
        await this.storage.setValue(key, payment);
        await this.hashesStorage.append(payment.hash);
      
    }

    async getPayment(hash: string): Promise<Payment | null> {
        const key = this.PAYMENT_PREFIX + hash;
        return await this.storage.getValue<Payment | null>(key);
    }

    async deletePayment(hash:string):Promise<void>{
        const key = this.PAYMENT_PREFIX + hash;
        await this.storage.remove(key);
        await this.hashesStorage.remove(hash);
    }

}