import type { specialVariables } from 'librechat-data-provider';
import { Calendar, User, Clock, Globe, Sparkles } from '~/components/icons';

type SpecialVariableKey = keyof typeof specialVariables;

export const specialVariableIcons: Record<
  SpecialVariableKey,
  React.ComponentType<{ className?: string }>
> = {
  current_date: Calendar,
  current_datetime: Clock,
  current_user: User,
  iso_datetime: Globe,
};

export const getSpecialVariableIcon = (name: string) =>
  specialVariableIcons[name as SpecialVariableKey] ?? Sparkles;
