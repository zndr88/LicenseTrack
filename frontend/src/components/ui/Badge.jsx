import React from "react";

const Badge = ({ type, children }) => (
  <span className={`badge badge-${type}`}><span className="badge-dot" />{children}</span>
);

export default React.memo(Badge);
