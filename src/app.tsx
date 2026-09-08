import { ThemeProvider } from "@/providers/theme-provider";

export function App() {
  return (
    <ThemeProvider>
      <div className="bg-background text-foreground flex h-full items-center justify-center">
        Confinaid Test Tool
      </div>
    </ThemeProvider>
  );
}
