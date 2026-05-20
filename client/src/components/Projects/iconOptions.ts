import {
  Palette,
  Folder,
  DollarSign,
  Smartphone,
  GraduationCap,
  Pencil,
  Brush,
  Braces,
  Terminal,
  Music,
  Popcorn,
  MessageSquareDashed,
  Stethoscope,
  Flower2,
  Sprout,
  ShoppingBag,
  BarChart3,
  Pill,
  Dumbbell,
  Receipt,
  Scale,
  Globe,
  Plane,
  Wrench,
  PawPrint,
  FlaskConical,
  Brain,
  Heart,
  ShoppingBasket,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ProjectIconOption = { name: string; Icon: LucideIcon };

export const PROJECT_ICONS: ProjectIconOption[] = [
  { name: 'Palette', Icon: Palette },
  { name: 'Folder', Icon: Folder },
  { name: 'DollarSign', Icon: DollarSign },
  { name: 'Smartphone', Icon: Smartphone },
  { name: 'GraduationCap', Icon: GraduationCap },
  { name: 'Pencil', Icon: Pencil },
  { name: 'Brush', Icon: Brush },
  { name: 'Braces', Icon: Braces },
  { name: 'Terminal', Icon: Terminal },
  { name: 'Music', Icon: Music },
  { name: 'Popcorn', Icon: Popcorn },
  { name: 'MessageSquareDashed', Icon: MessageSquareDashed },
  { name: 'Stethoscope', Icon: Stethoscope },
  { name: 'Flower2', Icon: Flower2 },
  { name: 'Sprout', Icon: Sprout },
  { name: 'ShoppingBag', Icon: ShoppingBag },
  { name: 'BarChart3', Icon: BarChart3 },
  { name: 'Pill', Icon: Pill },
  { name: 'Dumbbell', Icon: Dumbbell },
  { name: 'Receipt', Icon: Receipt },
  { name: 'Scale', Icon: Scale },
  { name: 'Globe', Icon: Globe },
  { name: 'Plane', Icon: Plane },
  { name: 'Wrench', Icon: Wrench },
  { name: 'PawPrint', Icon: PawPrint },
  { name: 'FlaskConical', Icon: FlaskConical },
  { name: 'Brain', Icon: Brain },
  { name: 'Heart', Icon: Heart },
  { name: 'ShoppingBasket', Icon: ShoppingBasket },
];

export type ProjectColorOption = { name: string; hex: string };

export const PROJECT_COLORS: ProjectColorOption[] = [
  { name: 'black', hex: '#0f172a' },
  { name: 'red', hex: '#ef4444' },
  { name: 'orange', hex: '#f97316' },
  { name: 'yellow', hex: '#eab308' },
  { name: 'green', hex: '#22c55e' },
  { name: 'blue', hex: '#3b82f6' },
  { name: 'purple', hex: '#a855f7' },
  { name: 'pink', hex: '#ec4899' },
];

export const DEFAULT_PROJECT_ICON = 'Palette';
export const DEFAULT_PROJECT_COLOR = 'pink';

export function resolveIcon(name?: string | null): LucideIcon {
  if (!name) return Palette;
  return PROJECT_ICONS.find((i) => i.name === name)?.Icon ?? Palette;
}

export function resolveColor(name?: string | null): string {
  if (!name) return '#ec4899';
  return PROJECT_COLORS.find((c) => c.name === name)?.hex ?? '#ec4899';
}
