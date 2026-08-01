import { Settings as SettingsIcon } from 'lucide-react'
import PagePlaceholder from '../components/PagePlaceholder'

export default function Settings() {
  return (
    <PagePlaceholder
      icon={SettingsIcon}
      title="Settings"
      description="Manage your account preferences."
      comingNext={[
        'Change password',
        'Change profile photo',
        'Notification preferences',
      ]}
    />
  )
}
