"""Conservative, non-diagnostic routing guidance for the local prototype."""

EMERGENCY = {"chest", "breathing", "stroke", "bleeding", "unconscious"}
SAME_DAY = {"injury", "pregnancy", "fever", "child"}

CONCERNS = [
    ("chest", "Chest pain or pressure"),
    ("breathing", "Trouble breathing"),
    ("stroke", "Possible stroke signs"),
    ("bleeding", "Severe bleeding"),
    ("unconscious", "Unconsciousness / overdose"),
    ("injury", "Severe injury or fracture"),
    ("pregnancy", "Pregnancy concern"),
    ("child", "Child is sick or injured"),
    ("fever", "Fever, dehydration, or worsening infection"),
    ("minor", "Minor injury or medication question"),
]


def assess(concerns: list[str]) -> dict:
    selected = [item for item in concerns if item in dict(CONCERNS)]
    if any(item in EMERGENCY for item in selected):
        return {
            "level": "emergency",
            "title": "Call 911 now if this is happening now or feels life-threatening.",
            "message": "Do not drive yourself when symptoms are severe. Emergency dispatch can direct you to the most appropriate emergency department.",
            "action": "Emergency care now",
        }
    if any(item in SAME_DAY for item in selected):
        return {
            "level": "same_day",
            "title": "Seek in-person assessment today.",
            "message": "The nearest live-listed hospital is shown first. Call ahead when it is safe to do so, especially for pregnancy or pediatric concerns.",
            "action": "Emergency department / same-day care",
        }
    return {
        "level": "routine",
        "title": "Consider urgent or routine care based on how you feel.",
        "message": "For minor concerns, a clinician, urgent care, or nurse line may be more appropriate than an emergency department. If symptoms worsen, seek emergency care.",
        "action": "Urgent or routine care",
    }


def filter_facilities(concerns: list[str], facilities: list[dict]) -> tuple[list[dict], str]:
    """Apply conservative, explainable care-guide filtering without diagnosing."""
    selected = {item for item in concerns if item in dict(CONCERNS)}
    hospitals = [item for item in facilities if item.get("kind") == "hospital"]
    urgent = [item for item in facilities if item.get("kind") == "urgent_care"]

    # Life-threatening, injury, pregnancy, and pediatric selections should not
    # be routed to urgent care by this non-clinical prototype.
    if selected & (EMERGENCY | {"injury", "pregnancy", "child"}):
        return (hospitals or facilities), "Hospital emergency-care options only"
    if "fever" in selected:
        return urgent + hospitals, "Urgent care first, followed by hospitals"
    if "minor" in selected:
        return (urgent or hospitals or facilities), "Urgent-care options only when available"
    return facilities, "Hospitals and urgent-care options"
