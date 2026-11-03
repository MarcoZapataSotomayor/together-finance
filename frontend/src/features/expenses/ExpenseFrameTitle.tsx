import {
  RibbonBow,
  StrawberrySprig,
} from '../../components/decorations/Ornaments'
export function ExpenseFrameTitle({
  title,
  id,
}: {
  title: string
  id: string
}) {
  return (
    <div className="expense-title-wrap">
      <StrawberrySprig className="title-crest" />
      <div className="title-plaque">
        <svg
          className="plaque-shape"
          viewBox="0 0 600 120"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M42 19Q52 4 77 10H256Q300-2 344 10h179q25-6 35 9l4 12q33 5 29 30t-29 29l-4 12q-10 15-35 9H344q-44 12-88 0H77q-25 6-35-9l-4-12Q5 86 9 61t29-30Z" />
        </svg>
        <h1 id={id}>{title}</h1>
      </div>
      <RibbonBow className="title-bow" />
    </div>
  )
}
