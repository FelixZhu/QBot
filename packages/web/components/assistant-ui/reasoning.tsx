import { ChainOfThoughtPrimitive } from "@assistant-ui/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRightIcon } from "lucide-react";
import type { FC } from "react";

export const Reasoning: FC = () => {
  return (
    <Collapsible defaultOpen={false} className="aui-reasoning-root">
      <CollapsibleTrigger className="aui-reasoning-trigger flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground transition-colors">
        <ChevronRightIcon className="aui-reasoning-trigger-icon size-3 transition-transform [[data-state=open]>&]:rotate-90" />
        Thinking...
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ChainOfThoughtPrimitive.Root className="aui-reasoning-content border-l-2 border-muted pl-3 text-muted-foreground text-sm" />
      </CollapsibleContent>
    </Collapsible>
  );
};

export const ReasoningGroup: FC = () => {
  return (
    <span className="aui-reasoning-group text-muted-foreground text-xs italic">
      Thinking...
    </span>
  );
};
