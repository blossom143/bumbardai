import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useUI = create<{
  dark: boolean;
  collapsed: boolean;
  toggleDark: () => void;
  toggleSidebar: () => void;
}>()(
  persist(
    (set) => ({
      dark: false,
      collapsed: false,
      toggleDark: () => set((state) => ({ dark: !state.dark })),
      toggleSidebar: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    { name: 'hallway-ui' },
  ),
);
