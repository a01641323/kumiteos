import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { AuthProvider } from "@/lib/auth-context";
import { AreaProvider } from "@/lib/area-context";
import { NetworkProvider } from "@/lib/network-context";
import { OverlayProvider } from "@/lib/overlay-context";
import { LocalStateProvider } from "@/lib/local-state-context";
import { TopTabs } from "@/components/top-tabs";
import { JuryModal } from "@/components/jury-modal";
import { BodyClassSync } from "@/components/body-class-sync";
import { SuperadminOverlay } from "@/components/superadmin-overlay";
import { ConnectionRequestModal } from "@/components/connection-request-modal";
import { ConnectionScreen } from "@/components/connection-screen";
import { BridgeBootstrap } from "@/components/bridge-bootstrap";

export const metadata: Metadata = {
  title: "Karate Tournament Scoring",
  description: "Admin / Private / Public live scoring for karate tournaments",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <BridgeBootstrap />
        <AuthProvider>
          <NetworkProvider>
            <LocalStateProvider>
              <AreaProvider>
                <StoreProvider>
                  <OverlayProvider>
                    <BodyClassSync />
                    <TopTabs />
                    {children}
                    <JuryModal />
                    <SuperadminOverlay />
                    <ConnectionRequestModal />
                    <ConnectionScreen />
                  </OverlayProvider>
                </StoreProvider>
              </AreaProvider>
            </LocalStateProvider>
          </NetworkProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
