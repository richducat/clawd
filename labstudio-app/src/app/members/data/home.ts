import {
  Activity,
  Camera,
  CheckSquare,
  Dumbbell,
  Heart,
  Scale,
  TrendingUp,
  Utensils,
} from 'lucide-react';

export type AgendaItem = {
  id: string;
  title: string;
  time: string;
  type: 'Workout' | 'Cardio' | 'Habit' | 'Check-in';
  action: string;
};

export const DAILY_AGENDA: AgendaItem[] = [
  { id: 'w1', title: 'Upper Body Hypertrophy', time: '6:00 AM', type: 'Workout', action: 'workout' },
  { id: 'c1', title: 'Zone 2 Cardio Ride', time: '12:30 PM', type: 'Cardio', action: 'workout' },
  { id: 'h1', title: 'Hydration Check', time: '2:00 PM', type: 'Habit', action: 'habits' },
  { id: 'p1', title: 'Progress Photo', time: '8:30 PM', type: 'Check-in', action: 'progress' },
];

export type ProgressTile = {
  id: string;
  label: string;
  value: string;
  trend: string;
  icon: any;
};

export const PROGRESS_TILES: ProgressTile[] = [
  { id: 'weight', label: 'Body Weight', value: '185 lbs', trend: '+0.4 wk', icon: Scale },
  { id: 'bodyfat', label: 'Body Fat', value: '14.0%', trend: '-0.3 wk', icon: Activity },
  { id: 'rhr', label: 'Resting HR', value: '58 bpm', trend: '-2 bpm', icon: Heart },
  { id: 'photos', label: 'Progress Photos', value: '3 New', trend: 'Added today', icon: Camera },
  { id: 'nutrition', label: 'Nutrition Avg', value: '92% compliant', trend: '+4% wk', icon: Utensils },
  { id: 'strength', label: 'Strength PRs', value: '2 this month', trend: 'New bench PR', icon: TrendingUp },
];

export const DEFAULT_PROFILE = {
  name: 'TAYLOR',
  goal: 'Hypertrophy',
  weight: 185,
  bf: 14,
};

export const DEFAULT_NUTRITION_LOG = [
  { id: 1, name: 'Oatmeal + Whey', p: 30, c: 45, f: 5, time: '08:00 AM' },
];
