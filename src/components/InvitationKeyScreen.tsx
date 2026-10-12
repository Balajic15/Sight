import React, { useState } from "react";
import { authService, type AuthState } from "@/lib/assistant/auth-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle } from "lucide-react";

interface InvitationKeyScreenProps {
  authState: AuthState;
}

export function InvitationKeyScreen({ authState }: InvitationKeyScreenProps) {
  const [keyInput, setKeyInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    authState.errorMessage || null,
  );

  const handleKeyChange = (val: string) => {
    setKeyInput(val);
    if (errorMessage) setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setErrorMessage("Please enter your invitation key.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await authService.redeemKey(trimmed);
    setIsSubmitting(false);

    if (!result.success) {
      setErrorMessage(
        result.error || "Invalid invitation key. Please check the key and try again.",
      );
    }
  };

  return (
    <div className="relative min-h-[100dvh] w-full flex flex-col items-center justify-center bg-background px-4 py-8 text-foreground selection:bg-primary/20">
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="h-[360px] w-[360px] rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm flex flex-col items-center">
        {/* App Title */}
        <div className="mb-6 flex flex-col items-center text-center">
          <h1 className="text-2xl font-bold tracking-tight">Echo</h1>
        </div>

        {/* Card Container */}
        <div className="w-full rounded-2xl border border-border/80 bg-card p-6 shadow-xl backdrop-blur-xs">
          <div className="mb-5 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Enter Invitation Key
            </h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Enter your invitation key to activate access.
            </p>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive animate-in fade-in"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1 leading-snug">{errorMessage}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <div className="relative">
                <Input
                  id="invitation-key"
                  type="text"
                  aria-label="Invitation Key"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  placeholder="Enter invitation key"
                  value={keyInput}
                  onChange={(e) => handleKeyChange(e.target.value)}
                  className="h-11 font-mono text-center tracking-wider text-sm bg-background/60 border-border"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !keyInput.trim()}
              className="w-full h-11 text-sm font-medium shadow-sm transition-all"
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
