export type RoomKind = "speaking" | "writing";
export function claimRoom(onTakenElsewhere: () => void, kind: RoomKind = "speaking"): () => void {
    if (typeof BroadcastChannel === "undefined")
        return () => { };
    const me = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ch = new BroadcastChannel(`tcfm-${kind}-room`);
    let live = true;
    ch.onmessage = (ev: MessageEvent<{
        claim?: string;
    }>) => {
        if (!live || !ev.data?.claim || ev.data.claim === me)
            return;
        live = false;
        ch.close();
        onTakenElsewhere();
    };
    ch.postMessage({ claim: me });
    return () => {
        if (!live)
            return;
        live = false;
        ch.close();
    };
}
