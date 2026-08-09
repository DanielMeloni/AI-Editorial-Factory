'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from './button';

/**
 * Interruttore chiaro/scuro.
 *
 * Le due icone sono entrambe nel DOM e vengono alternate via CSS: cosi' non
 * serve alcun flag "mounted" e non si verifica disallineamento fra HTML del
 * server e idratazione nel browser.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Alterna tema chiaro e scuro"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Moon className="block dark:hidden" aria-hidden="true" />
      <Sun className="hidden dark:block" aria-hidden="true" />
    </Button>
  );
}
