import { ClipboardList } from 'lucide-react'
import PagePlaceholder from '../components/PagePlaceholder'

export default function Assignments() {
  return (
    <PagePlaceholder
      icon={ClipboardList}
      title="Assignments"
      description="Admins can create and route assignments tied to items in the Submission Bin."
      comingNext={[
        'Assign submissions to reviewers by admin role',
        'Two-way link between an assignment and its submission',
        'Due dates and assignment status',
      ]}
    />
  )
}
