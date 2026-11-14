import type { TestStage } from "./api.ts";
import type { MockStore } from "./store.ts";
export type MockHooks = {
    stage: TestStage;
    sub: string;
    endsAt: number | null;
    store: MockStore;
    onStageEnd: (how: "done" | "abandon") => void;
    onLeave: () => void;
    onReady: () => void;
};
