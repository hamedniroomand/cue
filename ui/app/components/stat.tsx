import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"
import { cn } from "~/lib/utils"

export function Stat({
  label,
  value,
  hint,
  accent,
  className,
  style,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <Card
      className={cn("lift reveal justify-between", className)}
      style={style}
    >
      <CardHeader>
        <CardDescription className="font-mono text-label-md uppercase">
          {label}
        </CardDescription>
        <CardTitle
          className={cn(
            "text-3xl font-medium tabular-nums",
            accent && "text-brand-accent"
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      {hint && (
        <CardContent>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      )}
    </Card>
  )
}
