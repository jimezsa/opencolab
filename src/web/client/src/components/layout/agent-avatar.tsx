import octopusUrl from "@assets/octopus.png"
import claudeLogo from "@assets/claude-runtime.svg"
import openaiLogo from "@assets/openai-runtime.svg"
import piLogo from "@assets/pi-runtime.svg"
import { cn } from "@/lib/utils"

const PROVIDER_LOGOS: Record<string, string> = {
  anthropic: claudeLogo,
  claude: claudeLogo,
  minimax: claudeLogo,
  openai: openaiLogo,
  codex: openaiLogo,
  xai: piLogo,
  openrouter: piLogo,
  kimi: piLogo,
}

interface AgentAvatarProps {
  providerName: string
  className?: string
}

export function AgentAvatar({ providerName, className }: AgentAvatarProps) {
  const logo = PROVIDER_LOGOS[providerName.toLowerCase()]
  return (
    <div className={cn("relative mx-auto h-20 w-20", className)}>
      <img
        src={octopusUrl}
        alt=""
        aria-hidden
        className="h-full w-full object-contain [image-rendering:pixelated]"
      />
      {logo && (
        <div className="bg-background ring-background absolute left-1/2 top-[18%] flex size-1/3 -translate-x-1/2 items-center justify-center overflow-hidden rounded-full ring-2">
          <img
            src={logo}
            alt={`${providerName} logo`}
            className="size-3/4 object-contain"
          />
        </div>
      )}
    </div>
  )
}
