import { Card, Section, SkeletonLine, type Tone } from "./primitives";

export function PendingSection({ title, tone, label }: { title: string; tone: Tone; label: string }) {
  return (
    <Section tone={tone} title={title} titleClassName="text-zinc-500" meta={label} className="opacity-35">
      <Card className="p-5">
        <div className="flex flex-col gap-2">
          <SkeletonLine className="w-[60%]" />
          <SkeletonLine className="w-[85%]" />
          <SkeletonLine className="w-[40%]" />
        </div>
      </Card>
    </Section>
  );
}
