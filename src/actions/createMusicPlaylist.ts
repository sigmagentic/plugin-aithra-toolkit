import { composeContext, Content, generateImage, generateObject, generateObjectDeprecated, HandlerCallback, IAgentRuntime, Media, Memory, ModelClass, ServiceType, State } from "@elizaos/core";
import { convertBase64ToBuffer, Description, generateAudio, SchemaGenerator } from "../helpers";
import {aithraToolkitLogger}  from "@aithranetwork/sdk-aithra-toolkit";
import { validateAithraConfig } from "../environment";
import { AithraService } from "../services/aithraService";
import { PaymentsService } from "../services/paymentService";
import { Action } from "@elizaos/core";
import { ActionExample } from "@elizaos/core";




export class MusicPlaylistDetails {
    @Description("The release type of the music: EP | SINGLE | ALBUM")
    releaseType: "EP" | "SINGLE" | "ALBUM";

    @Description("The title of the music release")
    title: string;

    @Description("The style or genre of the music")
    style: string;

    @Description("The wallet address to send the music to")
    walletAddress: string;

    @Description("The transaction hash of the payment")
    paymentTxHash: string;

    @Description("How many nfts to mint")
    numberOfMints: number = 1;

    constructor(partial: Partial<MusicPlaylistDetails> = {}) {
        Object.assign(this, {
            releaseType: partial.releaseType,
            title: partial.title,
            style: partial.style,
            walletAddress: partial.walletAddress,
            paymentTxHash: partial.paymentTxHash,
            numberOfMints: Number(partial.numberOfMints) || 1,
        });
    }
}


export const extractPrompt = 
`
    Extract info from this content:

    {{recentMessages}}

    {{output_format}}
`;

export class GenerativePrompts { 
    @Description("Prompt used to generate the track cover image, at least 100 characters, required")
    coverImagePrompt: string;
    @Description("Prompt used to generate the audio of the track, at least 100 characters, required")
    audioPrompt: string;
    @Description("Lyrics with optional formatting. You can use a newline to separate each line of lyrics. You can use two newlines to add a pause between lines. You can use double hash marks (##) at the beginning and end of the lyrics to add accompaniment. Maximum 350 to 400 characters, required")
    lyrics: string;
    @Description("Prompt used to generate the cover image of the NFT, at least 100 characters, required")
    nftCoverImagePrompt: string;
    @Description("The description of the NFT, maximum 100 150 characters")
    nftDescription: string;
    @Description("The name of the nft, should follow camelCase format starting with uppercase letter, max 28 characters")
    nftName: string;
    @Description("The album title generated")
    albumTitle: string;

    constructor(partial: Partial<GenerativePrompts> = {}) {
        Object.assign(this, partial);
    }
}


export const generativePrompt = 
`
    Based on the following information:

    {{title}}

    {{style}}
    
    {{output_format}}
`;


export default {
    name:"CREATE_MUSIC_PLAYLIST",
    similes: ["MINT_MUSIC_PLAYLIST", 'GENERATE_MUSIC_PLAYLIST', 'CREATE_MUSIC_PLAYLIST'],
    validate: async(runtime: IAgentRuntime, message:Memory)=>{
        aithraToolkitLogger.info("Validating config for user:", message.userId);
        await validateAithraConfig(runtime);
        return true;
    },
    description:"Create a music playlist",
    handler: async (runtime:IAgentRuntime, message:Memory, state:State, _options: { [key: string]: unknown },
        callback?: HandlerCallback) =>{
        try {    
            aithraToolkitLogger.info("Creating music playlist for user:", message.userId);

            const aithraService = runtime.getService("aithra_toolkit" as ServiceType) as AithraService;

            aithraService.initialize(runtime);
            
            state = (await runtime.composeState(message,{output_format: SchemaGenerator.generateJSONSchema(MusicPlaylistDetails)})) as State;

            const context = composeContext({state,template:extractPrompt});

            const content = await generateObjectDeprecated({
                runtime,
                context: context,
                modelClass: ModelClass.LARGE,
            });

            const payload:MusicPlaylistDetails = new MusicPlaylistDetails(content);

            // To be used in catch block
            // to remove the payment if the minting fails
            _options = {paymentHash:payload.paymentTxHash}
            

            // Verify payment 

            const totalCost = await aithraService.getTotalCost(1, payload.numberOfMints);

            const paymentService = new PaymentsService(runtime.getSetting("SOLANA_RPC_URL") as string,runtime); 

            const paymentCheckResponse = await paymentService.verifyEligiblePayment({paymentHash:payload.paymentTxHash, totalCost, walletAddress:payload.walletAddress});

            if (paymentCheckResponse.isErr()){
                
                    if(callback){
                        callback({
                            text:`Payment verification failed: ${paymentCheckResponse.getErr().message}`,
                            content:{error:paymentCheckResponse.getErr().message}
                        })
                    }
                    return false;

            }

            state = (await runtime.composeState(message,{title:payload.title,style:payload.style,output_format: SchemaGenerator.generateJSONSchema(GenerativePrompts)})) as State;


            const generativePromptsContext = composeContext({state,template:generativePrompt});

            const generativePromptsContent = await generateObjectDeprecated({
                runtime,
                context: generativePromptsContext,
                modelClass: ModelClass.LARGE,
            });

            const generativePromptsPayload: GenerativePrompts = new GenerativePrompts(generativePromptsContent);

            const coverImageBase64 =  (await generateImage({
                prompt: generativePromptsPayload.coverImagePrompt,
                width: 512,
                height: 512,
                count: 1,
            }, runtime as IAgentRuntime)).data[0];


            const {buffer:coverImageBuffer, extension:coverImageExtension} = convertBase64ToBuffer(coverImageBase64);

            const nftImageBase64 = (await generateImage({
                prompt: generativePromptsPayload.nftCoverImagePrompt,
                width: 512,
                height: 512,
                count: 1,
            }, runtime as IAgentRuntime)).data[0];

            const {buffer:nftImageBuffer, extension:nftImageExtension} = convertBase64ToBuffer(nftImageBase64);


            if(callback){
                callback({
                    text:`Just finished generating the images`,
                })
            }

           
            const trackResponse = (await generateAudio({
                lyrics: generativePromptsPayload.lyrics,
            }, runtime as IAgentRuntime));

            if (trackResponse.isErr()){
                if(callback){
                    callback({
                        text:`Track generation failed: ${trackResponse.getErr().message}`,
                        content:{error:trackResponse.getErr().message}
                    })
                }
                return false;
            }


            if(callback){
                callback({
                    text:`Just finished generating the audio`,
                })
            }

            const trackBuffer = trackResponse.unwrap();


            aithraService.storeTrackToFolder({
                track:{
                    data:trackBuffer,
                    metadata:{
                        artist: "Aithra",
                        title: payload.title,
                        album: generativePromptsPayload.albumTitle,
                        category: payload.style,
                    },
                    image: coverImageBuffer,
                    imageExtension:coverImageExtension
                }
            })

            const animationMediaPath = aithraService.storeAnimationToFolder({
                animation:nftImageBuffer,
                extension:nftImageExtension
            })



            if(callback){
                callback({
                    text:`Minting the music playlist now`,
                })
            }


            const mintResponse = await aithraService.buildUploadMintMusicNFTs({
                playlist:{
                    name:`${payload.title} ${payload.releaseType}`,
                    creator: "Aithra",
                },
                tokenCode:"MUSIC",
                nft:{
                    tokenName:`MUS${generativePromptsPayload.nftName}`,
                    sellerFeeBasisPoints:50,
                    quantity: Number(payload.numberOfMints),
                    name:`MUS - ${generativePromptsPayload.nftName}`,
                    description:generativePromptsPayload.nftDescription,
                },
                animation:{
                    animationFile:animationMediaPath
                },
                creator: payload.walletAddress
            })
    


            if (mintResponse.success){
                if(callback){
                    callback({
                        text:`Music playlist minted successfully, ${payload.numberOfMints} NFTs minted. The asset ids are: ${mintResponse.assetIds}`,
                        content:{success:true}
                    })
                }
            }        
            return true;
        } catch (error) {

            const paymentService = new PaymentsService(runtime.getSetting("SOLANA_RPC_URL") as string,runtime); 

            const removeResponse = await paymentService.deletePayment(_options.paymentHash as string);

            if (removeResponse.isErr()){
                aithraToolkitLogger.error("Error removing the payment:", removeResponse.getErr());
            }

            aithraToolkitLogger.error("Error creating the playlist:", error);
            if (callback) {
                callback({
                    text: `Issue with creating the playlist: ${error.message}; Payment can be reutilized`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    examples:[
            [
                {
                    user:"{{user1}}",
                    content:{
                        text:"hey can you create me a unique song EP titled 'Show me the money!' in the style of Hard Rock Music and send it to my wallet 8QL8tp2kC9ZSHjArSvqGfti6pUYVyGvpvR6WFNtUzcYc. Here is the SOL payment TX: 4SC6GgGfayfambZ7ufeGzGAgXiRTUnci5eeu76qWxaKxCtJrm8nBjyrkaVHe75JYrseEkmxGbxV7efDGUhhgCwu5"
                    }
                },
                {
                    user:"{{user1}}",
                    content:{
                        text:"Creating the music playlist for you now",
                        action:"CREATE_MUSIC_PLAYLIST"
                    }
                }
            ]
    ] as ActionExample[][],
} as Action;