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

/**
 * A project's colour is drawn as the glyph on a disc of that same colour at 10%
 * alpha, so what has to stay legible is glyph-against-disc — and the disc sits on
 * a surface that flips from #ffffff to #0d0d0d between themes. These hexes are the
 * mid-luminance band that clears 3:1 (WCAG 1.4.11 non-text) on both: anything
 * lighter dissolves in the light theme, anything darker in the dark one.
 *
 * `name` is what gets persisted, so hexes may change freely — names may not.
 */
export const PROJECT_COLORS: ProjectColorOption[] = [
  { name: 'black', hex: '#64748b' },
  { name: 'red', hex: '#ef4444' },
  { name: 'orange', hex: '#ea580c' },
  { name: 'yellow', hex: '#a16207' },
  { name: 'green', hex: '#059669' },
  { name: 'blue', hex: '#3b82f6' },
  { name: 'purple', hex: '#a855f7' },
  { name: 'pink', hex: '#ec4899' },
];

export const DEFAULT_PROJECT_ICON = 'Folder';
export const DEFAULT_PROJECT_COLOR = 'black';

export function resolveIcon(name?: string | null): LucideIcon {
  if (!name) return Folder;
  return PROJECT_ICONS.find((i) => i.name === name)?.Icon ?? Folder;
}

const FALLBACK_COLOR =
  PROJECT_COLORS.find((c) => c.name === DEFAULT_PROJECT_COLOR)?.hex ?? PROJECT_COLORS[0].hex;

/** Projects created before the colour field existed carry no colour at all. */
export function resolveColor(name?: string | null): string {
  if (!name) return FALLBACK_COLOR;
  return PROJECT_COLORS.find((c) => c.name === name)?.hex ?? FALLBACK_COLOR;
}
