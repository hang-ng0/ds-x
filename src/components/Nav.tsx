import {Link} from "react-router";
export default function Nav(){
    return(
        <nav>
            <ul>
                <li>
                    <Link to = {'/'}>Home</Link>
                </li>
                <li>
                    <Link to={'/education'}>Education</Link>
                </li>
                <li>
                    <Link to={'/experience'}>Experience</Link>
                </li>
            </ul>
        </nav>
    )
}