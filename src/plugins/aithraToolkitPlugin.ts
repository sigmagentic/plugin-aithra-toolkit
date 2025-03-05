import { Plugin } from "@elizaos/core";
import { AithraService } from "../services/aithraService";
import createMusicPlaylist from "../actions/createMusicPlaylist";

export const aithraToolkitPlugin: Plugin = {
    name: "aithra-toolkit",
    description:
        "A simple toolkit enabling agents to tokenize any data with a few lines of code",
    actions: [createMusicPlaylist],
    providers: [],
    evaluators: [],
    services: [new AithraService()],
    clients: [],
};
