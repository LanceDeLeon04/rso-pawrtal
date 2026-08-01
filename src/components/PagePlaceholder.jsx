import './PagePlaceholder.css'

export default function PagePlaceholder({ icon: Icon, title, description, comingNext = [] }) {
  return (
    <div className="placeholder">
      <div className="placeholder__icon">
        <Icon size={26} strokeWidth={1.8} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>

      {comingNext.length > 0 && (
        <div className="placeholder__list">
          <span className="placeholder__list-label">Coming in this section</span>
          <ul>
            {comingNext.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
