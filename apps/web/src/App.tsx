import { useState } from "react";
import { DEFAULT_KEYS } from "@ai-game-workbench/core";
import { ApiSettings } from "./components/ApiSettings";
import { PixelSpriteGenerator } from "./components/PixelSpriteGenerator";
import { WorkbenchHub } from "./components/WorkbenchHub";
import { SpriteAnimator } from "./components/SpriteAnimator";

type ModuleId = "hub" | "sprite-animator" | "pixel-sprite-generator" | "api-settings";

export function App() {
  const [moduleId, setModuleId] = useState<ModuleId>("hub");

  if (moduleId === "sprite-animator") {
    return (
      <SpriteAnimator
        defaultKeys={DEFAULT_KEYS}
        onBack={() => setModuleId("hub")}
      />
    );
  }

  if (moduleId === "pixel-sprite-generator") {
    return <PixelSpriteGenerator onBack={() => setModuleId("hub")} />;
  }

  if (moduleId === "api-settings") {
    return <ApiSettings onBack={() => setModuleId("hub")} />;
  }

  return (
    <WorkbenchHub
      onOpenApiSettings={() => setModuleId("api-settings")}
      onOpenPixelSpriteGenerator={() => setModuleId("pixel-sprite-generator")}
      onOpenSpriteAnimator={() => setModuleId("sprite-animator")}
    />
  );
}
