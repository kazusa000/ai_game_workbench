import { useState } from "react";
import { DEFAULT_KEYS } from "@ai-game-workbench/core";
import { WorkbenchHub } from "./components/WorkbenchHub";
import { SpriteAnimator } from "./components/SpriteAnimator";

type ModuleId = "hub" | "sprite-animator";

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

  return <WorkbenchHub onOpenSpriteAnimator={() => setModuleId("sprite-animator")} />;
}
