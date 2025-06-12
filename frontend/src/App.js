import React, { useState, useRef } from 'react';
import { Layout, Upload, Button, Card, Spin, message, Table, List, Input, Space, Popconfirm, Modal, Tooltip, Radio, Switch, Checkbox } from 'antd';
import { UploadOutlined, FileSearchOutlined, PlusOutlined, SaveOutlined, CopyOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';
import './App.css';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

const { Header, Content, Sider } = Layout;

function App() {
    const [loading, setLoading] = useState(false);
    const [tables, setTables] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [search, setSearch] = useState('');
    const [editData, setEditData] = useState([]); // 当前表格的可编辑数据
    const [editColumns, setEditColumns] = useState([]); // 当前表格的可编辑列
    const [copied, setCopied] = useState(false);
    const [isAddColModalOpen, setIsAddColModalOpen] = useState(false);
    const [newColName, setNewColName] = useState('');
    const [colInsertIndex, setColInsertIndex] = useState(null); // 新列插入位置
    const [rowInsertIndex, setRowInsertIndex] = useState(null); // 新行插入位置
    const tableHeaderRef = useRef(null);
    const [hoverColIndex, setHoverColIndex] = useState(null); // 鼠标悬停的分割线索引
    const [addColBtnPos, setAddColBtnPos] = useState({ left: 0, visible: false });
    const [editingColIdx, setEditingColIdx] = useState(null); // 当前正在编辑的列索引
    const [editingColValue, setEditingColValue] = useState('');
    const [addColBtnHover, setAddColBtnHover] = useState(false); // 鼠标是否悬停在加号按钮上
    const [pageSize, setPageSize] = useState(10);
    const [editedTables, setEditedTables] = useState({}); // 缓存每个表格的编辑内容
    const [downloadModalOpen, setDownloadModalOpen] = useState(false);
    const [downloadType, setDownloadType] = useState('merge'); // merge, sheets, files
    const [mergeConflict, setMergeConflict] = useState(null); // 冲突信息
    const [forceMerge, setForceMerge] = useState(false); // 是否强制合并
    const [showThumbnail, setShowThumbnail] = useState(true);
    const [detecting, setDetecting] = useState(false);
    const [detectHint, setDetectHint] = useState('');
    const [reprocessing, setReprocessing] = useState(false);
    const [reprocessMsg, setReprocessMsg] = useState('');
    const [allSelected, setAllSelected] = useState(true);
    const [selectedTableIndexes, setSelectedTableIndexes] = useState([]);

    const handleUpload = async (file) => {
        if (!file.name.endsWith('.pdf')) {
            message.error('只支持PDF文件！');
            return;
        }

        setLoading(true);
        setDetecting(true);
        setDetectHint('正在识别表格，请耐心等待... 表格较多时，每个表格提取约1.3-1.5秒。');
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await axios.post('http://localhost:8000/upload', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });
            setTables(response.data.tables);
            setSelectedIndex(0);
            setEditedTables({});
            setDetecting(false);
            setDetectHint('');
            if (response.data.tables.length > 10) {
                setTimeout(() => {
                    message.info(
                        `本次共识别${response.data.tables.length}个表格，预计总耗时约${Math.round(response.data.tables.length * 1.4)}秒（每页约1.3-1.5秒）`,
                        10 // 停留10秒
                    );
                }, 500);
            }
            message.success('文件处理成功！');
        } catch (error) {
            setDetecting(false);
            setDetectHint('');
            message.error('处理文件时出错：' + error.message);
        } finally {
            setLoading(false);
        }
    };

    // 鼠标在表头移动时，判断是否靠近分割线（优化：只在分割线和加号都不悬停时才隐藏加号）
    const handleHeaderMouseMove = (e) => {
        let th = e.target;
        while (th && th.tagName !== 'TH') th = th.parentElement;
        if (!th) return;
        const tr = th.parentElement;
        const ths = Array.from(tr.children);
        let found = false;
        let left = 0;
        for (let i = 0; i < ths.length - 2; i++) {
            const rect = ths[i].getBoundingClientRect();
            const dist = Math.abs(e.clientX - rect.right);
            if (dist < 8) {
                found = true;
                left = rect.right - ths[0].getBoundingClientRect().left;
                setHoverColIndex(i + 1);
                setAddColBtnPos({ left, visible: true });
                break;
            }
        }
        if (!found && !addColBtnHover) {
            setAddColBtnPos(pos => pos.visible ? { ...pos, visible: false } : pos);
        }
    };
    // 鼠标离开表头时，只有加号也不悬停才隐藏
    const handleHeaderMouseLeave = () => {
        if (!addColBtnHover) {
            setAddColBtnPos(pos => pos.visible ? { ...pos, visible: false } : pos);
        }
    };

    // 切换到编辑状态
    const handleEditColName = (colIdx, oldName) => {
        setEditingColIdx(colIdx);
        setEditingColValue(oldName);
    };
    // 保存列名修改
    const handleSaveColName = (colIdx) => {
        const oldName = editColumns[colIdx];
        const newName = editingColValue.trim();
        if (!newName || editColumns.includes(newName)) {
            setEditingColIdx(null);
            setEditingColValue('');
            return;
        }
        setEditColumns((prev) => prev.map((c, i) => (i === colIdx ? newName : c)));
        setEditData((prev) => prev.map(row => {
            const newRow = { ...row };
            newRow[newName] = newRow[oldName];
            delete newRow[oldName];
            return newRow;
        }));
        setEditingColIdx(null);
        setEditingColValue('');
    };
    // 取消编辑
    const handleCancelColName = () => {
        setEditingColIdx(null);
        setEditingColValue('');
    };

    // 自动退出列名编辑（全局点击）
    React.useEffect(() => {
        if (editingColIdx === null) return;
        function handleClickOutside(e) {
            const input = document.getElementById('col-edit-input');
            if (input && !input.contains(e.target)) {
                handleSaveColName(editingColIdx);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [editingColIdx, editingColValue]);

    // 自动生成columns
    const getColumns = (data, onCellEdit, onDeleteRow) => {
        if (!data || editColumns.length === 0) return [];
        const columns = editColumns.map((key, colIdx) => ({
            title: (
                <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                    {editingColIdx === colIdx ? (
                        <Input
                            id="col-edit-input"
                            value={editingColValue}
                            onChange={e => setEditingColValue(e.target.value)}
                            onBlur={() => handleSaveColName(colIdx)}
                            onPressEnter={() => handleSaveColName(colIdx)}
                            onKeyDown={e => { if (e.key === 'Escape') handleCancelColName(); }}
                            size="small"
                            style={{ width: 80, marginRight: 4 }}
                            autoFocus
                        />
                    ) : (
                        <span
                            style={{ fontWeight: 500, cursor: 'pointer', userSelect: 'text' }}
                            onClick={() => handleEditColName(colIdx, key)}
                            onDoubleClick={() => handleEditColName(colIdx, key)}
                        >
                            {key}
                        </span>
                    )}
                    <Button
                        icon={<DeleteOutlined />}
                        size="small"
                        type="link"
                        danger
                        style={{ marginLeft: 2, verticalAlign: 'middle' }}
                        onClick={e => { e.stopPropagation(); handleDeleteColumn(key); }}
                    />
                </div>
            ),
            dataIndex: key,
            key,
            ellipsis: true,
            editable: true,
            onCell: (record, rowIndex) => ({
                record,
                editable: true,
                dataIndex: key,
                title: key,
                handleSave: (row) => onCellEdit(rowIndex, key, row[key]),
            }),
        }));
        // 增加删除行和插入行按钮（操作列）
        columns.push({
            title: '操作',
            key: 'action',
            width: 110,
            render: (_, record, rowIndex) => (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Tooltip title="在此下方插入新行">
                        <Button
                            icon={<PlusOutlined />}
                            size="small"
                            style={{ marginRight: 4, cursor: 'row-resize', opacity: 0.7 }}
                            onClick={() => handleAddRowAt(rowIndex + 1)}
                            onMouseOver={e => e.currentTarget.style.opacity = 1}
                            onMouseOut={e => e.currentTarget.style.opacity = 0.7}
                        />
                    </Tooltip>
                    <Popconfirm title="确定删除此行？" onConfirm={() => onDeleteRow(rowIndex)} okText="确定" cancelText="取消">
                        <Button icon={<DeleteOutlined />} size="small" danger />
                    </Popconfirm>
                </div>
            ),
        });
        return columns;
    };

    // 搜索过滤表格
    const filteredTables = tables.filter((table, idx) => {
        if (!search) return true;
        const data = table.data || [];
        const html = table.html_table || '';
        return (
            html.includes(search) ||
            (data.length > 0 && Object.values(data[0]).join(',').includes(search))
        );
    });

    // 当前选中的表格
    const currentTable = filteredTables[selectedIndex] || null;

    // 选中表格变化时，初始化可编辑数据
    React.useEffect(() => {
        if (currentTable && currentTable.data) {
            setEditData(currentTable.data.map((row, i) => ({ ...row, key: i })));
            setEditColumns(currentTable.data.length > 0 ? Object.keys(currentTable.data[0]) : []);
        } else {
            setEditData([]);
            setEditColumns([]);
        }
    }, [currentTable]);

    // 切换表格时恢复缓存内容（只依赖selectedIndex和tables，优先缓存，无则用原始数据）
    React.useEffect(() => {
        if (editedTables[selectedIndex]) {
            setEditData(editedTables[selectedIndex].data);
            setEditColumns(editedTables[selectedIndex].columns);
        } else if (tables[selectedIndex] && tables[selectedIndex].data) {
            setEditData(tables[selectedIndex].data.map((row, i) => ({ ...row, key: i })));
            setEditColumns(tables[selectedIndex].data.length > 0 ? Object.keys(tables[selectedIndex].data[0]) : []);
        } else {
            setEditData([]);
            setEditColumns([]);
        }
        // eslint-disable-next-line
    }, [selectedIndex, tables]);

    // 编辑时实时更新缓存
    React.useEffect(() => {
        if (selectedIndex !== null) {
            setEditedTables(prev => ({
                ...prev,
                [selectedIndex]: { data: editData, columns: editColumns }
            }));
        }
        // eslint-disable-next-line
    }, [editData, editColumns]);

    // 单元格编辑保存
    const handleCellEdit = (rowIndex, key, value) => {
        setEditData((prev) => {
            const newData = [...prev];
            newData[rowIndex] = { ...newData[rowIndex], [key]: value };
            return newData;
        });
    };

    // 添加新行（插入到指定位置）
    const handleAddRowAt = (index) => {
        const emptyRow = {};
        editColumns.forEach((col) => (emptyRow[col] = ''));
        setEditData((prev) => {
            const newData = [...prev];
            newData.splice(index, 0, { ...emptyRow, key: Date.now() + Math.random() });
            return newData.map((row, i) => ({ ...row, key: i }));
        });
    };

    // 删除行
    const handleDeleteRow = (rowIndex) => {
        setEditData((prev) => prev.filter((_, idx) => idx !== rowIndex).map((row, i) => ({ ...row, key: i })));
    };

    // 保存为CSV
    const handleSaveCSV = () => {
        if (!editData.length) return;
        const csvRows = [];
        csvRows.push(editColumns.join(','));
        editData.forEach(row => {
            csvRows.push(editColumns.map(col => '"' + (row[col] || '').replace(/"/g, '""') + '"').join(','));
        });
        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `table_${selectedIndex + 1}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // 复制为TSV
    const handleCopy = () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    const tsvString = editData.length
        ? [editColumns.join('\t'), ...editData.map(row => editColumns.map(col => row[col]).join('\t'))].join('\n')
        : '';

    // 生成HTML表格字符串用于复制
    const htmlTableString = () => {
        if (!editData.length || !editColumns.length) return '';
        let html = '<table><thead><tr>';
        html += editColumns.map(col => `<th>${col}</th>`).join('');
        html += '</tr></thead><tbody>';
        editData.forEach(row => {
            html += '<tr>' + editColumns.map(col => `<td>${row[col] ?? ''}</td>`).join('') + '</tr>';
        });
        html += '</tbody></table>';
        return html;
    };

    // 复制HTML表格到剪贴板
    const handleCopyHtmlTable = () => {
        const html = htmlTableString();
        if (!html) return;
        const listener = (e) => {
            e.preventDefault();
            e.clipboardData.setData('text/html', html);
            e.clipboardData.setData('text/plain', tsvString);
        };
        document.addEventListener('copy', listener);
        document.execCommand('copy');
        document.removeEventListener('copy', listener);
        message.success('已复制为表格，可直接粘贴到Excel/Word/邮件等');
    };

    // 可编辑单元格组件
    const EditableCell = ({ editable, children, dataIndex, record, handleSave, ...restProps }) => {
        // Hooks 必须在组件顶层调用
        const [editing, setEditing] = React.useState(false);
        const [value, setValue] = React.useState(record ? record[dataIndex] : '');
        const inputRef = React.useRef(null);

        React.useEffect(() => {
            if (editing) inputRef.current && inputRef.current.focus();
        }, [editing]);

        if (!editable || !record || !dataIndex) {
            return <td {...restProps}>{children}</td>;
        }

        const toggleEdit = () => setEditing(!editing);
        const save = () => {
            setEditing(false);
            handleSave({ ...record, [dataIndex]: value });
        };
        return (
            <td {...restProps} onClick={toggleEdit} style={{ cursor: 'pointer', minWidth: 80 }}>
                {editing ? (
                    <Input
                        ref={inputRef}
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        onPressEnter={save}
                        onBlur={save}
                        size="small"
                    />
                ) : (
                    <div style={{ minHeight: 24 }}>{children}</div>
                )}
            </td>
        );
    };

    // 添加新列（插入到指定位置）
    const handleAddColumn = () => {
        if (!newColName || editColumns.includes(newColName)) {
            message.error('列名不能为空且不能重复');
            return;
        }
        setEditColumns((prev) => {
            const newCols = [...prev];
            newCols.splice(colInsertIndex !== null ? colInsertIndex : prev.length, 0, newColName);
            return newCols;
        });
        setEditData((prev) => prev.map(row => {
            const newRow = { ...row };
            newRow[newColName] = '';
            return newRow;
        }));
        setIsAddColModalOpen(false);
        setNewColName('');
        setColInsertIndex(null);
    };

    // 删除列
    const handleDeleteColumn = (col) => {
        Modal.confirm({
            title: `确定删除列"${col}"吗？`,
            okText: '确定',
            cancelText: '取消',
            onOk: () => {
                setEditColumns((prev) => prev.filter(c => c !== col));
                setEditData((prev) => prev.map(row => {
                    const newRow = { ...row };
                    delete newRow[col];
                    return newRow;
                }));
            }
        });
    };

    // 检查表头冲突并高亮差异（保留真实索引）
    const checkHeaderConflict = (allTables) => {
        const allColsArr = Object.entries(allTables).map(([realIdx, t]) => ({ realIdx, cols: t.columns }));
        const allColsSet = new Set(allColsArr.flatMap(item => item.cols));
        const allCols = Array.from(allColsSet);
        const unique = new Set(allColsArr.map(item => JSON.stringify(item.cols)));
        if (unique.size === 1) return null;
        // 生成每个表格的高亮差异
        const details = allColsArr.map(({ realIdx, cols }) => {
            const diff = allCols.filter(col => !cols.includes(col));
            return {
                realIdx,
                cols,
                diff,
            };
        });
        return { details, allCols };
    };

    // 上传后默认全选
    React.useEffect(() => {
        setAllSelected(true);
        setSelectedTableIndexes(tables.map((_, idx) => idx));
    }, [tables]);

    // 全选/取消全选
    const handleSelectAll = (checked) => {
        setAllSelected(checked);
        setSelectedTableIndexes(checked ? tables.map((_, idx) => idx) : []);
    };
    // 单个勾选
    const handleSelectTable = (idx, checked) => {
        setSelectedTableIndexes(prev =>
            checked ? [...prev, idx] : prev.filter(i => i !== idx)
        );
    };

    // 批量下载相关
    const handleBatchDownload = async () => {
        // 只导出选中的表格
        const allTables = tables.reduce((acc, t, i) => {
            if (!selectedTableIndexes.includes(i)) return acc;
            if (editedTables[i]) {
                acc[i] = editedTables[i];
            } else {
                acc[i] = { data: t.data, columns: t.data.length > 0 ? Object.keys(t.data[0]) : [] };
            }
            return acc;
        }, {});
        if (downloadType === 'merge' && !forceMerge) {
            const conflict = checkHeaderConflict(allTables);
            if (conflict) {
                setMergeConflict(conflict);
                return;
            }
        }
        if (downloadType === 'merge') {
            // 合并为一个Excel
            let merged = [];
            let columns = [];
            if (forceMerge) {
                // 取所有表头并集
                const allCols = Array.from(new Set(Object.values(allTables).flatMap(t => t.columns)));
                columns = allCols;
            }
            Object.values(allTables).forEach((t, idx) => {
                if (t.data.length > 0) {
                    if (!columns.length) columns = t.columns;
                    merged = merged.concat(t.data.map(row => {
                        const r = {};
                        columns.forEach(col => { r[col] = row[col] ?? ''; });
                        r['__表格序号'] = idx + 1;
                        return r;
                    }));
                }
            });
            const ws = XLSX.utils.json_to_sheet(merged);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '合并表格');
            XLSX.writeFile(wb, 'merged_tables.xlsx');
        } else if (downloadType === 'sheets') {
            // 多Sheet Excel
            const wb = XLSX.utils.book_new();
            Object.values(allTables).forEach((t, idx) => {
                if (t.data.length > 0) {
                    const ws = XLSX.utils.json_to_sheet(t.data);
                    XLSX.utils.book_append_sheet(wb, ws, `表格${idx + 1}`);
                }
            });
            XLSX.writeFile(wb, 'tables_sheets.xlsx');
        } else if (downloadType === 'files') {
            // 多个单独Excel文件，zip打包
            const zip = new JSZip();
            await Promise.all(Object.values(allTables).map(async (t, idx) => {
                if (t.data.length > 0) {
                    const ws = XLSX.utils.json_to_sheet(t.data);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, `表格${idx + 1}`);
                    const wbout = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
                    zip.file(`table_${idx + 1}.xlsx`, wbout);
                }
            }));
            const content = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = 'tables.zip';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        setDownloadModalOpen(false);
        setMergeConflict(null);
        setForceMerge(false);
    };

    // 只弹一次冲突弹窗，强制合并时用useEffect监听forceMerge后再执行下载
    React.useEffect(() => {
        if (forceMerge) {
            handleBatchDownload();
        }
        // eslint-disable-next-line
    }, [forceMerge]);

    // 新窗口打开大图
    const openImageInNewWindow = (imgUrl) => {
        const win = window.open();
        if (win) {
            win.document.write(`
                <html>
                    <head><title>表格大图预览</title></head>
                    <body style="margin:0;text-align:center;background:#222;">
                        <img src="${imgUrl}" style="max-width:100vw;max-height:100vh;object-fit:contain;background:#fff;" />
                    </body>
                </html>
            `);
            win.document.close();
        }
    };

    // 重新识别本页
    const handleReprocessPage = async () => {
        if (!currentTable || !currentTable.pageIndex || !currentTable.fileName) {
            message.error('缺少页码或文件信息，无法重新识别');
            return;
        }
        setReprocessing(true);
        setReprocessMsg('正在重新识别本页...');
        try {
            const res = await axios.post('http://localhost:8000/reprocess', {
                fileName: currentTable.fileName,
                pageIndex: currentTable.pageIndex
            });
            // 假设返回新表格数据，替换当前表格内容
            setEditedTables(prev => ({
                ...prev,
                [selectedIndex]: { data: res.data.data, columns: res.data.columns }
            }));
            setEditData(res.data.data);
            setEditColumns(res.data.columns);
            setReprocessMsg('重新识别成功！');
            setTimeout(() => setReprocessing(false), 1000);
        } catch (e) {
            setReprocessMsg('重新识别失败，请重试');
            setTimeout(() => setReprocessing(false), 1500);
        }
    };

    return (
        <Layout className="layout" style={{ minHeight: '100vh' }}>
            <Header style={{ background: '#fff', padding: '0 20px' }}>
                <h1>PDF表格提取器</h1>
            </Header>
            <Content style={{ padding: '20px' }}>
                <div style={{ marginBottom: '20px' }}>
                    <Upload
                        beforeUpload={(file) => {
                            handleUpload(file);
                            return false;
                        }}
                        showUploadList={false}
                    >
                        <Button icon={<UploadOutlined />}>选择PDF文件</Button>
                    </Upload>
                </div>
                {detecting && (
                    <div style={{ textAlign: 'center', margin: '24px 0', color: '#1890ff', fontSize: 16 }}>
                        <Spin /> {detectHint}
                    </div>
                )}
                {!loading && tables.length > 0 && (
                    <Layout style={{ background: 'transparent' }}>
                        <Sider width={260} style={{ background: '#fff', marginRight: 24, borderRadius: 8, boxShadow: '0 2px 8px #f0f1f2', padding: 16 }}>
                            <div style={{ marginBottom: 8 }}>
                                <Checkbox checked={allSelected} onChange={e => handleSelectAll(e.target.checked)}>全选</Checkbox>
                            </div>
                            <Input
                                placeholder="搜索表格内容/表头"
                                prefix={<FileSearchOutlined />}
                                value={search}
                                onChange={e => { setSearch(e.target.value); setSelectedIndex(0); }}
                                style={{ marginBottom: 16 }}
                            />
                            <div style={{ height: 'calc(100vh - 260px)', overflowY: 'auto', paddingRight: 4 }}>
                                <List
                                    itemLayout="horizontal"
                                    dataSource={filteredTables}
                                    renderItem={(item, idx) => {
                                        // 计算真实索引
                                        const realIdx = tables.findIndex(t => t === item);
                                        return (
                                            <List.Item
                                                style={{
                                                    background: idx === selectedIndex ? '#e6f7ff' : undefined,
                                                    borderRadius: 4,
                                                    cursor: 'pointer',
                                                    marginBottom: 8,
                                                    border: idx === selectedIndex ? '1px solid #1890ff' : '1px solid #f0f0f0',
                                                }}
                                                onClick={() => { setSelectedIndex(realIdx); setCopied(false); }}
                                            >
                                                {!allSelected && (
                                                    <Checkbox
                                                        checked={selectedTableIndexes.includes(realIdx)}
                                                        onChange={e => handleSelectTable(realIdx, e.target.checked)}
                                                        style={{ marginRight: 8 }}
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                )}
                                                <List.Item.Meta
                                                    avatar={<img src={item.image} alt={`表格${realIdx + 1}`} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid #eee' }} />}
                                                    title={`表格 ${realIdx + 1}`}
                                                    description={<span style={{ fontSize: 12, color: '#888' }}>{item.data && item.data.length > 0 ? Object.keys(item.data[0]).join(', ') : ''}</span>}
                                                />
                                            </List.Item>
                                        );
                                    }}
                                />
                            </div>
                            <div style={{ marginTop: 16, textAlign: 'center' }}>
                                <Button type="primary" onClick={() => setDownloadModalOpen(true)}>批量下载</Button>
                                <Modal
                                    title="批量下载表格"
                                    open={downloadModalOpen}
                                    onOk={handleBatchDownload}
                                    onCancel={() => setDownloadModalOpen(false)}
                                    okText="下载"
                                    cancelText="取消"
                                >
                                    <Radio.Group
                                        value={downloadType}
                                        onChange={e => setDownloadType(e.target.value)}
                                        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                                    >
                                        <Radio value="merge">合并为一个Excel</Radio>
                                        <Radio value="sheets">多Sheet Excel</Radio>
                                        <Radio value="files">多个单独Excel（zip打包）</Radio>
                                    </Radio.Group>
                                </Modal>
                            </div>
                        </Sider>
                        <Content style={{ background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px #f0f1f2', padding: 24, minHeight: 400 }}>
                            {currentTable ? (
                                <>
                                    <Space style={{ marginBottom: 16 }}>
                                        <Switch checked={showThumbnail} onChange={setShowThumbnail} />
                                        <span>显示缩略图</span>
                                        {showThumbnail && currentTable && currentTable.image && (
                                            <Button size="small" onClick={() => openImageInNewWindow(currentTable.image)}>在新窗口打开大图</Button>
                                        )}
                                        <Button icon={<SaveOutlined />} onClick={handleSaveCSV}>保存为CSV</Button>
                                        <CopyToClipboard text={tsvString} onCopy={handleCopy}>
                                            <Button icon={<CopyOutlined />}>{copied ? '已复制' : '无格式复制'}</Button>
                                        </CopyToClipboard>
                                        <Button icon={<CopyOutlined />} onClick={handleCopyHtmlTable}>复制表格</Button>
                                        <Button loading={reprocessing} onClick={handleReprocessPage} type="dashed">重新识别本页</Button>
                                        {reprocessing && <span style={{ color: '#1890ff', marginLeft: 8 }}>{reprocessMsg}</span>}
                                    </Space>
                                    {showThumbnail && currentTable && currentTable.image && (
                                        <div style={{ marginBottom: 20 }}>
                                            <img
                                                src={currentTable.image}
                                                alt={`表格${selectedIndex + 1}`}
                                                style={{ width: '100%', maxHeight: 240, objectFit: 'contain', borderRadius: 4, cursor: 'pointer' }}
                                                onClick={() => openImageInNewWindow(currentTable.image)}
                                            />
                                        </div>
                                    )}
                                    <div style={{ position: 'relative' }}>
                                        {/* 加号按钮绝对定位在表头上方 */}
                                        {addColBtnPos.visible && (
                                            <Button
                                                icon={<PlusOutlined />}
                                                size="small"
                                                style={{
                                                    position: 'absolute',
                                                    top: -24,
                                                    left: addColBtnPos.left - 12,
                                                    zIndex: 10,
                                                    background: '#fff',
                                                    border: '1px solid #1890ff',
                                                    color: '#1890ff',
                                                    boxShadow: '0 2px 8px #eee',
                                                    cursor: 'pointer',
                                                }}
                                                onClick={() => {
                                                    setColInsertIndex(hoverColIndex);
                                                    setIsAddColModalOpen(true);
                                                }}
                                                onMouseEnter={() => setAddColBtnHover(true)}
                                                onMouseLeave={() => {
                                                    setAddColBtnHover(false);
                                                    setAddColBtnPos(pos => pos.visible ? { ...pos, visible: false } : pos);
                                                }}
                                            />
                                        )}
                                        <Table
                                            ref={tableHeaderRef}
                                            columns={getColumns(editData, handleCellEdit, handleDeleteRow)}
                                            dataSource={editData}
                                            pagination={{
                                                pageSize,
                                                showSizeChanger: true,
                                                pageSizeOptions: ['10', '20', '50', '100', editData.length > 100 ? String(editData.length) : undefined].filter(Boolean),
                                                showTotal: (total, range) => `${range[0]}-${range[1]} / 共${total}行`,
                                                onShowSizeChange: (current, size) => setPageSize(size),
                                            }}
                                            scroll={{ x: 'max-content' }}
                                            bordered
                                            size="middle"
                                            components={{
                                                body: {
                                                    cell: EditableCell,
                                                },
                                            }}
                                            onHeaderRow={() => ({
                                                onMouseMove: handleHeaderMouseMove,
                                                onMouseLeave: handleHeaderMouseLeave,
                                            })}
                                        />
                                    </div>
                                    <Modal
                                        title="添加新列"
                                        open={isAddColModalOpen}
                                        onOk={handleAddColumn}
                                        onCancel={() => { setIsAddColModalOpen(false); setNewColName(''); setColInsertIndex(null); }}
                                        okText="添加"
                                        cancelText="取消"
                                    >
                                        <Input
                                            placeholder="请输入新列名"
                                            value={newColName}
                                            onChange={e => setNewColName(e.target.value)}
                                            onPressEnter={handleAddColumn}
                                            maxLength={32}
                                        />
                                    </Modal>
                                </>
                            ) : (
                                <div style={{ textAlign: 'center', color: '#aaa' }}>未找到匹配的表格</div>
                            )}
                        </Content>
                    </Layout>
                )}
                {mergeConflict && (
                    <Modal
                        open={!!mergeConflict}
                        title="表头冲突提示"
                        onOk={() => { setForceMerge(true); setMergeConflict(null); }}
                        onCancel={() => { setMergeConflict(null); setForceMerge(false); }}
                        okText="强制合并"
                        cancelText="取消"
                    >
                        <div style={{ color: 'red', marginBottom: 12 }}>检测到表头不一致，强制合并会将所有表头取并集，缺失字段留空。</div>
                        <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 13, marginBottom: 12 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'left', padding: 4 }}>表格序号</th>
                                        <th style={{ textAlign: 'left', padding: 4 }}>表头字段（红色为缺失字段）</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mergeConflict.details.map(({ realIdx, cols, diff }) => (
                                        <tr key={realIdx}>
                                            <td style={{ padding: 4 }}>表格 {parseInt(realIdx) + 1}</td>
                                            <td style={{ padding: 4 }}>
                                                {mergeConflict.allCols.map((col, i) => (
                                                    <>
                                                        {i > 0 && <span style={{ color: '#bbb', margin: '0 4px' }}>|</span>}
                                                        {cols.includes(col)
                                                            ? <span key={col} style={{}}>{col}</span>
                                                            : <span key={col} style={{ color: 'red', fontWeight: 600 }}>{col}</span>
                                                        }
                                                    </>
                                                ))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ fontSize: 13, color: '#888' }}>
                            <b>合并后所有字段：</b> {mergeConflict.allCols.map((col, i) => <span key={col}>{i > 0 && <span style={{ color: '#bbb', margin: '0 4px' }}>|</span>}{col}</span>)}
                        </div>
                    </Modal>
                )}
            </Content>
        </Layout>
    );
}

export default App; 