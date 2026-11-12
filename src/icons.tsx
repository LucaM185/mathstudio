import {
  Activity, ArrowDown, BrainCircuit, ArrowLeft, ArrowRight, ArrowRightFromLine, ArrowUp, ArrowUpFromLine, Ban, Blend, Brush,
  ChartLine, CircleDot, Code2, Combine, Eraser, Expand, FlipHorizontal2, HeartPulse, Image, Keyboard, Maximize2,
  Minimize2, MoveUpRight, PaintBucket, Palette, Pencil, PenLine, RotateCcw, RotateCw, ScanLine, Shapes, Shrink,
  Shuffle, Sigma, Sparkle, Waves, Zap, Box, type LucideIcon,
} from 'lucide-react';

export const ANIM_ICONS: Record<string, LucideIcon> = {
  none: Ban,
  // enter
  FadeIn: Blend,
  FadeInUp: ArrowUp,
  FadeInDown: ArrowDown,
  FadeInLeft: ArrowLeft,
  FadeInRight: ArrowRight,
  FadeInSmall: Maximize2,
  FadeInLarge: Minimize2,
  GrowFromCenter: Expand,
  GrowFromLeft: ArrowRightFromLine,
  GrowFromBottom: ArrowUpFromLine,
  SpinIn: RotateCw,
  Write: PenLine,
  ShowCreation: Pencil,
  DrawBorderThenFill: PaintBucket,
  Typewriter: Keyboard,
  // exit
  FadeOut: Blend,
  FadeOutUp: ArrowUp,
  FadeOutDown: ArrowDown,
  FadeOutLeft: ArrowLeft,
  FadeOutRight: ArrowRight,
  FadeOutSmall: Minimize2,
  FadeOutLarge: Maximize2,
  ShrinkToCenter: Shrink,
  SpinOut: RotateCcw,
  Uncreate: Eraser,
  Unwrite: Eraser,
  TransformInto: Shuffle,
  TransformMatching: Combine,
  // effects
  Indicate: Sparkle,
  Wiggle: Activity,
  Pulse: HeartPulse,
  Spin: RotateCw,
  Flip: FlipHorizontal2,
  FlashAround: ScanLine,
  Flash: Zap,
  CircleIndicate: CircleDot,
  ApplyWave: Waves,
  ColorPulse: Palette,
};

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Shapes: Shapes,
  'Lines & Arrows': MoveUpRight,
  'Text & Math': Sigma,
  Graphs: ChartLine,
  '3D': Box,
  'AI & ML': BrainCircuit,
  Drawings: Brush,
  Media: Image,
  Custom: Code2,
};

export function AnimIcon({ id, size = 14, className }: { id: string; size?: number; className?: string }) {
  const I = ANIM_ICONS[id] || Sparkle;
  return <I size={size} className={className} strokeWidth={2} />;
}

export function CategoryIcon({ category, size = 14 }: { category: string; size?: number }) {
  const I = CATEGORY_ICONS[category] || Code2;
  return <I size={size} strokeWidth={2} />;
}
