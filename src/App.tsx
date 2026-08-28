import { useEffect, useState } from 'react'
import HomePage from './ui/pages/HomePage'
import PlayerPage from './ui/pages/PlayerPage'
import HistoryPage from './ui/pages/HistoryPage'
import FavoritesPage from './ui/pages/FavoritesPage'
import SettingsPage from './ui/pages/SettingsPage'

type Route = 'home' | 'player' | 'history' | 'favorites' | 'settings'

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '') as Route
  return ['home', 'player', 'history', 'favorites', 'settings'].includes(hash)
    ? hash
    : 'home'
}

export function navigate(to: Route) {
  window.location.hash = `/${to}`
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute)

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="app-shell">
      {route === 'home' && <HomePage />}
      {route === 'player' && <PlayerPage />}
      {route === 'history' && <HistoryPage />}
      {route === 'favorites' && <FavoritesPage />}
      {route === 'settings' && <SettingsPage />}
      <nav className="tabbar">
        <button className={route === 'home' ? 'tab active' : 'tab'} onClick={() => navigate('home')}>编排</button>
        <button className={route === 'history' ? 'tab active' : 'tab'} onClick={() => navigate('history')}>历史</button>
        <button className={route === 'favorites' ? 'tab active' : 'tab'} onClick={() => navigate('favorites')}>收藏</button>
        <button className={route === 'settings' ? 'tab active' : 'tab'} onClick={() => navigate('settings')}>设置</button>
      </nav>
    </div>
  )
}