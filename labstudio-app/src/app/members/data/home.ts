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
  { id: 'weight', label: 'Body Weight', value: '—', trend: '', icon: Scale },
  { id: 'bodyfat', label: 'Body Fat', value: '—', trend: '', icon: Activity },
  { id: 'rhr', label: 'Resting HR', value: '—', trend: '', icon: Heart },
  { id: 'photos', label: 'Progress Photos', value: '—', trend: '', icon: Camera },
  { id: 'nutrition', label: 'Nutrition Avg', value: '—', trend: '', icon: Utensils },
  { id: 'strength', label: 'Strength PRs', value: '—', trend: '', icon: TrendingUp },
];
