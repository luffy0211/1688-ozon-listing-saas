"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "./ui";

export type WorkflowStep = {
  label: string;
  sublabel: string;
};

export function WorkflowShell({
  steps,
  initialStep,
  children,
}: {
  steps: WorkflowStep[];
  initialStep: number;
  children: ReactNode[];
}) {
  const [currentStep, setCurrentStep] = useState(() =>
    initialStep >= 1 && initialStep <= steps.length ? initialStep : 1,
  );

  useEffect(() => {
    const saved = Number(window.sessionStorage.getItem("listing_workflow_step"));
    const validInitial = initialStep >= 1 && initialStep <= steps.length ? initialStep : null;
    const validSaved = Number.isInteger(saved) && saved >= 1 && saved <= steps.length ? saved : null;
    setCurrentStep(validInitial ?? validSaved ?? 1);
  }, [initialStep, steps.length]);

  useEffect(() => {
    window.sessionStorage.setItem("listing_workflow_step", String(currentStep));
  }, [currentStep]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => {
          const n = index + 1;
          const active = n === currentStep;
          const completed = n < currentStep;

          return (
            <button
              key={step.label}
              type="button"
              onClick={() => setCurrentStep(n)}
              className={cn(
                "flex min-h-20 items-center gap-3 rounded-lg border p-4 text-left shadow-sm transition-colors",
                active && "border-blue-200 bg-blue-50 text-blue-950",
                completed && "border-emerald-200 bg-emerald-50 text-emerald-950",
                !active && !completed && "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                  active && "bg-blue-600 text-white",
                  completed && "bg-emerald-600 text-white",
                  !active && !completed && "bg-gray-100 text-gray-600",
                )}
              >
                {completed ? <Check className="h-4 w-4" aria-hidden="true" /> : n}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{step.label}</span>
                <span className={cn("mt-1 block text-xs leading-5", active || completed ? "text-current" : "text-gray-500")}>
                  {step.sublabel}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div>{children[currentStep - 1]}</div>
    </div>
  );
}
