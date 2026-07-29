import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("rounded-md border px-3 py-2 space-y-1", {
  variants: {
    variant: {
      default: "border-border bg-muted/40 text-foreground",
      warning: "border-warning/40 bg-warning/10 text-warning-foreground",
      destructive: "border-destructive/40 bg-destructive/10 text-destructive",
      success: "border-success/40 bg-success/10 text-success-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

function Alert({ className, variant, children, ...props }) {
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {children}
    </div>
  );
}

function AlertTitle({ className, ...props }) {
  return <p className={cn("text-xs font-medium", className)} {...props} />;
}

function AlertDescription({ className, ...props }) {
  return <p className={cn("text-xs leading-snug", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
