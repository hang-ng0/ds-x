import {Link} from "react-router";
export default function Nav(){
    return(
        <nav>
            <ul>
                <li>
                    <Link to = {'/'}>Home</Link>
                </li>
                <li>
                    <Link to={'/paint'}>Paint</Link>
                </li>
                <li>
                    <Link to={'/gallery'}>Gallery</Link>
                </li>
            </ul>
        </nav>
    )
}