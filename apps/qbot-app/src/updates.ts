/** Download an EAS Update without switching the running bundle. Failure keeps what is already installed. */

export type UpdateProbe = {
  enabled: boolean;
  check(): Promise<{ isAvailable: boolean }>;
  fetch(): Promise<void>;
};

export type UpdatePull = "skipped" | "none" | "fetched" | "failed";

export async function pullUpdate(probe: UpdateProbe): Promise<UpdatePull> {
  if (!probe.enabled) return "skipped";
  try {
    const found = await probe.check();
    if (!found.isAvailable) return "none";
    await probe.fetch();
    return "fetched";
  } catch {
    return "failed";
  }
}
