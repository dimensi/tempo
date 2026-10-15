let reachable = true;
export function networkReachable() {
  return reachable;
}
export const networkStatusEvent = 'tempo:network-status';
export function reportNetworkResult(reachableResult: boolean) {
  reachable = reachableResult;
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent(networkStatusEvent, { detail: reachableResult }),
    );
}
