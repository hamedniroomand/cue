import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { type Theme, useTheme } from "~/lib/theme";

const OPTIONS: Array<{
  value: Theme;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();

  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      value={[theme]}
      // Base UI single-select yields [] when the active item is re-clicked.
      onValueChange={(next) => {
        const picked = next[0];
        if (picked) setTheme(picked as Theme);
      }}
      aria-label="Color theme"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger
            render={
              <ToggleGroupItem value={value} aria-label={label}>
                <Icon />
              </ToggleGroupItem>
            }
          />
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
