const HEADERS = ['النوع', 'الاسم', 'رقم العضوية', 'صفة المشارك', 'الفرع'];

const normalizeText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar');

const cellText = (value) => {
  if (value && typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('').trim();
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return String(value.text ?? '').trim();
  }
  return String(value ?? '').trim();
};

export function parseParticipantRows(rows, branches) {
  const header = (rows[0] || []).map(cellText);
  if (HEADERS.some((label, index) => normalizeText(header[index]) !== normalizeText(label))) {
    return {
      participants: [],
      errors: [`الصف الأول يجب أن يحتوي بالترتيب على: ${HEADERS.join('، ')}`],
    };
  }

  const branchByName = new Map();
  branches.forEach(branch => {
    const branchName = normalizeText(branch.name);
    branchByName.set(branchName, branch.id);
    if (branchName === normalizeText('القاهرة') || branchName === normalizeText('المركز العام')) {
      branchByName.set(normalizeText('القاهرة'), branch.id);
      branchByName.set(normalizeText('المركز العام'), branch.id);
    }
  });

  const participants = [];
  const errors = [];
  rows.slice(1).forEach((row, index) => {
    const values = Array.from({ length: HEADERS.length }, (_, cellIndex) => cellText(row[cellIndex]));
    if (values.every(value => !value)) return;

    const [typeValue, fullName, membershipNumber, participantPosition, branchName] = values;
    const participantType = normalizeText(typeValue) === normalizeText('متطوع')
      ? 'volunteer'
      : normalizeText(typeValue) === normalizeText('غير متطوع')
        ? 'non_volunteer'
        : null;
    const rowErrors = [];
    const rowNumber = index + 2;

    if (!participantType) rowErrors.push('النوع يجب أن يكون «متطوع» أو «غير متطوع»');
    if (!fullName) rowErrors.push('الاسم مطلوب');

    let branchId = null;
    if (participantType === 'volunteer') {
      if (!membershipNumber) rowErrors.push('رقم العضوية مطلوب للمتطوع');
      if (!branchName) rowErrors.push('الفرع مطلوب للمتطوع');
      else {
        branchId = branchByName.get(normalizeText(branchName)) ?? null;
        if (branchId === null) rowErrors.push(`الفرع «${branchName}» غير موجود في قائمة الفروع`);
      }
    } else if (participantType === 'non_volunteer' && !participantPosition) {
      rowErrors.push('صفة المشارك مطلوبة لغير المتطوع');
    }

    if (rowErrors.length) {
      errors.push(`الصف ${rowNumber}: ${rowErrors.join('، ')}`);
      return;
    }

    participants.push({
      id: `excel-${Date.now()}-${rowNumber}-${Math.random().toString(36).slice(2, 7)}`,
      participant_type: participantType,
      full_name: fullName,
      participation_role: participantType === 'volunteer' ? membershipNumber : '',
      participant_position: participantType === 'non_volunteer' ? participantPosition : '',
      branch_id: branchId,
      team_name: '',
      assigned_days: [],
    });
  });

  return { participants, errors };
}

export { HEADERS as PARTICIPANT_IMPORT_HEADERS };
