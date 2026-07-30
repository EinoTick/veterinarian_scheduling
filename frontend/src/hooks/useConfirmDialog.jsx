import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Accessible confirm dialog (replaces window.confirm).
 * Usage:
 *   const { confirm, ConfirmDialog } = useConfirmDialog();
 *   if (!(await confirm({ title, description }))) return;
 *   return <>…<ConfirmDialog /></>
 */
export function useConfirmDialog() {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState({
    title: "Confirm",
    description: "",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    destructive: false,
  });
  const resolver = useRef(null);

  const finish = useCallback((value) => {
    setOpen(false);
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(value);
  }, []);

  useEffect(() => () => {
    if (resolver.current) {
      resolver.current(false);
      resolver.current = null;
    }
  }, []);

  const confirm = useCallback((options = {}) => {
    if (resolver.current) {
      resolver.current(false);
      resolver.current = null;
    }
    setOpts({
      title: options.title || "Confirm",
      description: options.description || "",
      confirmLabel: options.confirmLabel || "Confirm",
      cancelLabel: options.cancelLabel || "Cancel",
      destructive: Boolean(options.destructive),
    });
    setOpen(true);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const ConfirmDialog = useMemo(() => {
    function ConfirmDialogComponent() {
      return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) finish(false); }}>
          <DialogContent className="max-w-sm" aria-describedby="confirm-desc">
            <DialogHeader>
              <DialogTitle>{opts.title}</DialogTitle>
            </DialogHeader>
            {opts.description ? (
              <p id="confirm-desc" className="text-sm text-muted-foreground whitespace-pre-wrap">
                {opts.description}
              </p>
            ) : (
              <p id="confirm-desc" className="sr-only">Confirm this action</p>
            )}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => finish(false)}
                autoFocus={opts.destructive}
              >
                {opts.cancelLabel}
              </Button>
              <Button
                type="button"
                variant={opts.destructive ? "destructive" : "default"}
                onClick={() => finish(true)}
                autoFocus={!opts.destructive}
              >
                {opts.confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }
    return ConfirmDialogComponent;
  }, [open, opts, finish]);

  return { confirm, ConfirmDialog };
}
