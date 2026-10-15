export const networkStatusEvent = 'tempo:network-status';
export function reportNetworkResult(reachable: boolean) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent(networkStatusEvent, { detail: reachable }),
    );
}
