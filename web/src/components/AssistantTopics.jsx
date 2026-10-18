import { Button, Dropdown, Empty, App } from 'antd'
import { PlusOutlined, MoreOutlined, MessageOutlined, PushpinOutlined } from '@ant-design/icons'

/** Topics belong to the active assistant and occupy the lower sidebar section. */
export default function AssistantTopics({ topics, activeTopicId, onSelect, onNew, onRename, onPin, onDelete }) {
  const { modal } = App.useApp()
  const sorted = [...topics].sort((a,b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0))
  return <div className="assistant-topics" role="group" aria-label="助手下的话题">
    <Button className="topic-new" type="text" size="small" icon={<PlusOutlined />} onClick={onNew}>新建话题</Button>
    {!sorted.length && <div className="topic-empty">暂无话题，点击上方开始新对话</div>}
    {sorted.map(t => <div className={`topic-row ${activeTopicId === t.id ? 'active' : ''}`} key={t.id}>
      <button className="topic-select" aria-current={activeTopicId === t.id ? 'page' : undefined} onClick={() => onSelect(t.id)} title={t.name}>
        {t.pinned ? <PushpinOutlined /> : <MessageOutlined />}<span>{t.name}</span>
      </button>
      <Dropdown trigger={['click']} menu={{ items: [
        {key:'rename', label:'重命名'},
        {key:'pin', label:t.pinned ? '取消置顶' : '置顶话题'},
        {type:'divider'},
        {key:'delete', label:'删除话题', danger:true}
      ], onClick: ({key}) => {
        if(key === 'rename') onRename(t)
        if(key === 'pin') onPin(t)
        if(key === 'delete') modal.confirm({title:`删除话题「${t.name}」？`,content:'此话题内的消息将一并删除，其他话题不受影响。',okText:'删除',cancelText:'取消',okButtonProps:{danger:true},onOk:()=>onDelete(t)})
      }}}><Button type="text" size="small" className="topic-more" icon={<MoreOutlined />} aria-label={`话题操作 ${t.name}`} /></Dropdown>
    </div>)}
  </div>
}
