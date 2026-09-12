import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';

const tabs: { name: string; title: string; icon: SymbolViewProps['name'] }[] = [
  { name: 'index', title: 'Inicio', icon: { ios: 'house', android: 'home' } },
  {
    name: 'transactions',
    title: 'Transacciones',
    icon: { ios: 'list.bullet', android: 'list' },
  },
  {
    name: 'budget',
    title: 'Presupuesto',
    icon: { ios: 'chart.pie', android: 'pie_chart' },
  },
  {
    name: 'household',
    title: 'Hogar',
    icon: { ios: 'person.2', android: 'group' },
  },
  {
    name: 'settings',
    title: 'Ajustes',
    icon: { ios: 'gearshape', android: 'settings' },
  },
];
export default function AppLayout() {
  return (
    <Tabs initialRouteName="index" screenOptions={{ headerShown: false }}>
      {tabs.map(({ name, title, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarAccessibilityLabel: title,
            tabBarIcon: ({ color, size }) => (
              <SymbolView
                name={icon}
                tintColor={color}
                size={size}
                accessible={false}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
