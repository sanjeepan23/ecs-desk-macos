import { FleetView } from '@/features/fleet'
import { useApp } from '@/store/app'

import { ClustersView, ClusterView } from './ClustersView'
import { EventsView } from './EventsView'
import { LogsView } from './LogsView'
import { OverviewView } from './OverviewView'
import { ServicesView } from './ServicesView'
import { ServiceView } from './ServiceView'
import { SettingsView } from './SettingsView'
import { TasksView } from './TasksView'
import { TaskView } from './TaskView'

/** Renders the page for the current view in the store. */
export function ViewRouter() {
  const view = useApp((s) => s.view)
  switch (view.name) {
    case 'overview':
      return <OverviewView />
    case 'clusters':
      return <ClustersView />
    case 'cluster':
      return <ClusterView key={view.cluster} cluster={view.cluster} />
    case 'services':
      return <ServicesView />
    case 'service':
      return <ServiceView key={`${view.cluster}/${view.service}`} cluster={view.cluster} service={view.service} tab={view.tab} taskState={view.taskState} />
    case 'tasks':
      return <TasksView />
    case 'task':
      return <TaskView key={view.taskArn} cluster={view.cluster} service={view.service} taskArn={view.taskArn} />
    case 'logs':
      return <LogsView />
    case 'events':
      return <EventsView />
    case 'settings':
      return <SettingsView />
    case 'fleet':
      return <FleetView />
  }
}
