import { useEffect } from 'preact/hooks';
import { NowScreen } from './screens/now';
import { PricesScreen } from './screens/prices';
import { DayScreen, ScheduleScreen } from './screens/schedule';
import { SettingsScreen } from './screens/settings';
import { UsageScreen } from './screens/usage';
import { WaterDayScreen, WaterScreen } from './screens/water';
import { useRoute } from './ui';

const TABS = [
  ['now', 'Now', 'M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6'],
  ['schedule', 'Heating', 'M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-5 .5 1.5 1.5 2.5 3 3 0-3-1-5.5 0-8z'],
  ['water', 'Water', 'M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z'],
  ['usage', 'Usage', 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
  ['prices', 'Prices', 'M17 7a5 5 0 1 0 0 10M4 10h9M4 14h9'],
  ['settings', 'Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
] as const;

export function App() {
  const route = useRoute();
  useEffect(() => { window.scrollTo(0, 0); }, [route]);
  const tab = route.name === 'day' ? 'schedule' : route.name === 'waterday' ? 'water' : route.name;
  return (
    <>
      <main>
        {route.name === 'now' && <NowScreen />}
        {route.name === 'schedule' && <ScheduleScreen />}
        {route.name === 'day' && <DayScreen day={route.day} />}
        {route.name === 'water' && <WaterScreen />}
        {route.name === 'waterday' && <WaterDayScreen day={route.day} />}
        {route.name === 'usage' && <UsageScreen />}
        {route.name === 'prices' && <PricesScreen />}
        {route.name === 'settings' && <SettingsScreen />}
      </main>
      <nav class="tabbar">
        {TABS.map(([id, label, d]) => (
          <a href={`#/${id}`} class={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
