import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './src/theme/colors';
import { ensureAllTags } from './src/api/sakugabooru';
import SearchScreen from './src/screens/SearchScreen';
import ShowSearchScreen from './src/screens/ShowSearchScreen';
import ShowDetailScreen from './src/screens/ShowDetailScreen';
import EpisodeResultsScreen from './src/screens/EpisodeResultsScreen';
import ViewerScreen from './src/screens/ViewerScreen';
import PlaylistsScreen from './src/screens/PlaylistsScreen';
import PlaylistDetailScreen from './src/screens/PlaylistDetailScreen';

const RootStack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const SearchStackNav = createNativeStackNavigator();
const ShowsStackNav = createNativeStackNavigator();
const PlaylistsStackNav = createNativeStackNavigator();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.panel2,
    text: colors.text,
    border: colors.line,
    primary: colors.amber,
  },
};

const screenOptions = {
  headerStyle: { backgroundColor: colors.panel2 },
  headerTintColor: colors.amber,
  headerTitleStyle: { color: colors.text },
};

// A small branding moment on the app's main entry point, matching the
// bookmarklet's distinctive amber-accent identity instead of a plain title.
// Matches the bookmarklet's own established header identity — "SAKUGA" dim,
// "ENHANCER" in the amber accent — plus a small, deliberately-visible credit
// to sakugabooru itself, since this whole app is built entirely on their API
// and community, and that shouldn't be hidden.
function BrandTitle() {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ color: colors.dim, fontSize: 17, fontWeight: '600', letterSpacing: 0.5 }}>SAKUGA </Text>
        <Text style={{ color: colors.amber, fontSize: 17, fontWeight: 'bold', letterSpacing: 0.5 }}>ENHANCER</Text>
      </View>
      <Text style={{ color: colors.dim, fontSize: 9, opacity: 0.7 }}>powered by sakugabooru.com</Text>
    </View>
  );
}

function SearchStack() {
  return (
    <SearchStackNav.Navigator screenOptions={screenOptions}>
      <SearchStackNav.Screen name="Search" component={SearchScreen} options={{ headerTitle: () => <BrandTitle /> }} />
    </SearchStackNav.Navigator>
  );
}

// Shows gets its own nested stack so drilling into a show, an episode, and
// related titles all get real native back-navigation (hardware back button /
// swipe-back gesture) for free — this replaces the bookmarklet's manual
// Back/Forward button pair, which was a web-specific workaround for not
// having a real navigation stack to begin with.
function ShowsStack() {
  return (
    <ShowsStackNav.Navigator screenOptions={screenOptions}>
      <ShowsStackNav.Screen name="ShowSearch" component={ShowSearchScreen} options={{ title: 'Shows' }} />
      <ShowsStackNav.Screen name="ShowDetail" component={ShowDetailScreen} />
      <ShowsStackNav.Screen name="EpisodeResults" component={EpisodeResultsScreen} />
    </ShowsStackNav.Navigator>
  );
}

// Same reasoning as ShowsStack — PlaylistDetail is specific to this tab
// (unlike Viewer, which is shared/reachable from anywhere), so it gets its
// own nested stack for real native back-navigation.
function PlaylistsStack() {
  return (
    <PlaylistsStackNav.Navigator screenOptions={screenOptions}>
      <PlaylistsStackNav.Screen
        name="PlaylistsHome"
        component={PlaylistsScreen}
        options={{ title: 'Pools' }}
      />
      <PlaylistsStackNav.Screen
        name="PlaylistDetail"
        component={PlaylistDetailScreen}
        options={{ title: 'Pool' }}
      />
    </PlaylistsStackNav.Navigator>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.panel2, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.amber,
        tabBarInactiveTintColor: colors.dim,
      }}
    >
      <Tabs.Screen
        name="SearchTab"
        component={SearchStack}
        options={{
          title: 'Search',
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="ShowsTab"
        component={ShowsStack}
        options={{
          title: 'Shows',
          tabBarIcon: ({ color, size }) => <Ionicons name="tv-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="PlaylistsTab"
        component={PlaylistsStack}
        options={{
          title: 'Pools',
          tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color} />,
        }}
      />
    </Tabs.Navigator>
  );
}

export default function App() {
  // Speculatively start warming the tag dictionary the moment the app opens
  // (checking the persistent cache first, only hitting the network if it's
  // genuinely stale) — by the time someone actually finishes typing their
  // first search, this is often already done or well underway, instead of
  // only starting at the moment of that first search.
  useEffect(() => {
    ensureAllTags().catch(() => {
      // A failed prefetch isn't worth surfacing — whatever actually needs
      // the dictionary later will just try again and can show its own error.
    });
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme}>
        <StatusBar style="light" />
        <RootStack.Navigator screenOptions={screenOptions}>
          <RootStack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          {/* Viewer sits at the root, shared by both tabs — either tab's
              navigation.navigate('Viewer', ...) bubbles up to find it here. */}
          <RootStack.Screen name="Viewer" component={ViewerScreen} options={{ title: 'Clip' }} />
        </RootStack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
