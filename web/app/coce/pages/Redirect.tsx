import { useEffect } from "react";
import { replace } from "../../../ui/router.ts";
export function Redirect({ to }: {
    to: string;
}) {
    useEffect(() => { replace(to); }, [to]);
    return <div className="boot" aria-busy="true"/>;
}
