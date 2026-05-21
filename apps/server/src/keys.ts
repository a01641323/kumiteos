import * as fs from "fs";
import * as path from "path";
import { generateKeyPair, exportPKCS8, exportSPKI, importPKCS8, importSPKI } from "jose";
import type { KeyLike } from "jose";
import { ensureDir } from "./storage";

export interface KeyPair {
  privateKey: KeyLike;
  publicKey: KeyLike;
  publicKeySpki: string;   // PEM, embeddable in desktop main
  privateKeyPkcs8: string; // PEM, persisted in dataDir/keys/ only
  kid: string;
}

export const KID = "2026-01";
export const ALG = "EdDSA";

export async function loadOrCreateKeys(dataDir: string): Promise<KeyPair> {
  const dir = path.join(dataDir, "keys");
  ensureDir(dir);
  const privPath = path.join(dir, "ed25519-private.pem");
  const pubPath = path.join(dir, "ed25519-public.pem");

  let privPem: string;
  let pubPem: string;

  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    privPem = fs.readFileSync(privPath, "utf8");
    pubPem = fs.readFileSync(pubPath, "utf8");
  } else {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    privPem = await exportPKCS8(privateKey);
    pubPem = await exportSPKI(publicKey);
    fs.writeFileSync(privPath, privPem, { encoding: "utf8", mode: 0o600 });
    fs.writeFileSync(pubPath, pubPem, "utf8");
  }

  const privateKey = await importPKCS8(privPem, ALG);
  const publicKey = await importSPKI(pubPem, ALG);
  return {
    privateKey,
    publicKey,
    publicKeySpki: pubPem,
    privateKeyPkcs8: privPem,
    kid: KID,
  };
}
